"""Transform — bronze Parquet ➜ gold star schema (Apache Spark / PySpark).

This is the "big data" stage. It runs on Spark in local[*] mode by default
(every core on the machine, no cluster required) and scales unchanged to a
standalone/YARN/K8s cluster by pointing SPARK_MASTER at it.

It reads the flat bronze snapshots, dedups by id (latest updatedAt wins, so an
incremental append never double-counts), and models a Kimball-style star:

  Dimensions   dim_date, dim_user, dim_room
  Facts        fact_message (grain: 1 message)
               fact_ai_call (grain: 1 AI call)
               fact_room_activity_daily (grain: 1 room x 1 day, pre-aggregated)

Conversation content (message bodies, AI question/answer text) is dropped here
unless INCLUDE_MESSAGE_TEXT=true — the warehouse stores derived metrics, not
what people said, matching Parley's privacy stance.

Run standalone:  python -m spark.transform
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import IntegerType

from config.settings import settings


def _ensure_compatible_java() -> None:
    """Spark 3.5 needs Java 8/11/17; newer system JDKs (e.g. 21/25) break it.

    Resolution order:
      1. PARLEY_JAVA_HOME, if set, wins (point it at any compatible JDK).
      2. A project-local JDK at data-pipeline/.jdk17 (see `make jdk`), if present.
      3. Otherwise leave JAVA_HOME as-is and let Spark use it.
    """
    override = os.getenv("PARLEY_JAVA_HOME")
    if override:
        os.environ["JAVA_HOME"] = override
        return
    bundled = Path(__file__).resolve().parent.parent / ".jdk17" / "lib" / "jvm"
    if bundled.exists():
        os.environ["JAVA_HOME"] = str(bundled)
        os.environ["PATH"] = f"{bundled / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}"


def build_spark() -> SparkSession:
    _ensure_compatible_java()
    return (
        SparkSession.builder.master(settings.spark_master)
        .appName(settings.spark_app_name)
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", "8")  # small local datasets
        .getOrCreate()
    )


# --- UDF: length of a JSON-array string column (citations, sourceKeys) -------
@F.udf(returnType=IntegerType())
def _json_len(text: str | None) -> int:
    if not text:
        return 0
    try:
        parsed = json.loads(text)
        return len(parsed) if isinstance(parsed, list) else 0
    except (ValueError, TypeError):
        return 0


def _read_bronze(spark: SparkSession, name: str) -> DataFrame:
    path = str(settings.bronze_dir / f"{name}.parquet")
    return spark.read.parquet(path)


def _dedup_latest(df: DataFrame) -> DataFrame:
    """Keep one row per id — the most recently updated. Bronze can hold history
    from incremental appends; the gold layer is current-state."""
    if "updatedAt" not in df.columns:
        return df.dropDuplicates(["id"])
    w = Window.partitionBy("id").orderBy(F.col("updatedAt").desc())
    return df.withColumn("_rn", F.row_number().over(w)).where(F.col("_rn") == 1).drop("_rn")


def _with_date_key(df: DataFrame, ts_col: str) -> DataFrame:
    """Add created_at (timestamp) and date_key (yyyymmdd int) from an ISO column."""
    ts = F.to_timestamp(F.col(ts_col))
    return df.withColumn("created_at", ts).withColumn(
        "date_key",
        (F.year(ts) * 10000 + F.month(ts) * 100 + F.dayofmonth(ts)).cast(IntegerType()),
    )


# --- Dimensions --------------------------------------------------------------
def build_dim_user(spark: SparkSession) -> DataFrame:
    users = _dedup_latest(_read_bronze(spark, "users"))
    return users.select(
        F.col("id").alias("user_id"),
        F.col("username"),
        F.col("displayName").alias("display_name"),
        F.to_timestamp("createdAt").alias("account_created_at"),
        F.to_timestamp("lastSeenAt").alias("last_seen_at"),
    )


def build_dim_room(spark: SparkSession) -> DataFrame:
    rooms = _dedup_latest(_read_bronze(spark, "rooms"))
    cols = rooms.columns
    return rooms.select(
        F.col("id").alias("room_id"),
        F.col("name"),
        F.col("slug"),
        F.coalesce(F.col("isDM"), F.lit(False)).alias("is_dm"),
        F.coalesce(F.col("aiEnabled"), F.lit(True)).alias("ai_enabled"),
        # creatorId is null for system-seeded rooms (#general) — keep the row.
        (F.col("creatorId") if "creatorId" in cols else F.lit(None)).alias("creator_user_id"),
        F.to_timestamp("createdAt").alias("room_created_at"),
    )


def build_dim_date(facts: list[DataFrame]) -> DataFrame:
    """Generate a contiguous calendar covering every date present in the facts."""
    spark = facts[0].sparkSession
    bounds = facts[0].select(F.min("created_at").alias("lo"), F.max("created_at").alias("hi"))
    for f in facts[1:]:
        b = f.select(F.min("created_at").alias("lo"), F.max("created_at").alias("hi"))
        bounds = bounds.union(b)
    span = bounds.agg(
        F.to_date(F.min("lo")).alias("lo"), F.to_date(F.max("hi")).alias("hi")
    ).collect()[0]

    if span["lo"] is None:  # no facts at all — emit a single placeholder day
        return spark.createDataFrame([], schema=_DIM_DATE_EMPTY_SCHEMA)

    dates = (
        spark.range(1)
        .select(F.explode(F.sequence(F.lit(span["lo"]), F.lit(span["hi"]), F.expr("interval 1 day"))).alias("d"))
    )
    return dates.select(
        (F.year("d") * 10000 + F.month("d") * 100 + F.dayofmonth("d")).cast(IntegerType()).alias("date_key"),
        F.col("d").alias("date"),
        F.year("d").alias("year"),
        F.quarter("d").alias("quarter"),
        F.month("d").alias("month"),
        F.date_format("d", "MMMM").alias("month_name"),
        F.dayofmonth("d").alias("day"),
        F.dayofweek("d").alias("day_of_week"),
        F.date_format("d", "EEEE").alias("day_name"),
        F.dayofweek("d").isin(1, 7).alias("is_weekend"),
    )


_DIM_DATE_EMPTY_SCHEMA = (
    "date_key INT, date DATE, year INT, quarter INT, month INT, month_name STRING, "
    "day INT, day_of_week INT, day_name STRING, is_weekend BOOLEAN"
)


# --- Facts -------------------------------------------------------------------
def build_fact_message(spark: SparkSession) -> DataFrame:
    msgs = _dedup_latest(_read_bronze(spark, "messages"))
    msgs = _with_date_key(msgs, "createdAt")
    cols = msgs.columns
    citations = F.col("citations") if "citations" in cols else F.lit(None).cast("string")
    ai_question = F.col("aiQuestion") if "aiQuestion" in cols else F.lit(None).cast("string")

    cols = [
        F.col("id").alias("message_id"),
        F.col("roomId").alias("room_id"),
        F.col("senderId").alias("sender_id"),
        F.col("date_key"),
        F.col("created_at"),
        F.col("kind"),
        (F.col("kind") == "ai").alias("is_ai_answer"),
        F.length(F.col("body")).alias("body_length"),
        F.size(F.split(F.trim(F.col("body")), r"\s+")).alias("word_count"),
        (citations.isNotNull()).alias("has_citations"),
        _json_len(citations).alias("citation_count"),
        (ai_question.isNotNull()).alias("has_ai_question"),
    ]
    if settings.include_message_text:
        cols.append(F.col("body"))  # opt-in raw content — selected from source
    return msgs.select(*cols)


def build_fact_ai_call(spark: SparkSession) -> DataFrame:
    calls = _dedup_latest(_read_bronze(spark, "aicalls"))
    calls = _with_date_key(calls, "createdAt")
    cols = calls.columns
    source_keys = F.col("sourceKeys") if "sourceKeys" in cols else F.lit(None).cast("string")

    cols = [
        F.col("streamId").alias("stream_id"),
        F.col("userId").alias("user_id"),
        F.col("date_key"),
        F.col("created_at"),
        F.col("kind"),
        F.col("provider"),
        F.col("model"),
        F.coalesce(F.col("tokensIn"), F.lit(0)).alias("tokens_in"),
        F.coalesce(F.col("tokensOut"), F.lit(0)).alias("tokens_out"),
        (F.coalesce(F.col("tokensIn"), F.lit(0)) + F.coalesce(F.col("tokensOut"), F.lit(0))).alias("total_tokens"),
        F.coalesce(F.col("latencyMs"), F.lit(0)).alias("latency_ms"),
        F.coalesce(F.col("cached"), F.lit(False)).alias("cached"),
        F.coalesce(F.col("ok"), F.lit(True)).alias("ok"),
        F.col("errorCode").alias("error_code"),
        F.col("verdict"),
        F.coalesce(F.col("retrievalHits"), F.lit(0)).alias("retrieval_hits"),
        _json_len(source_keys).alias("source_count"),
        # verdict is null for unrated calls; "null == 'up'" is null, not false,
        # so coalesce to a real boolean for clean BOOLEAN columns.
        F.coalesce(F.col("verdict") == "up", F.lit(False)).alias("is_thumbs_up"),
        F.coalesce(F.col("verdict") == "down", F.lit(False)).alias("is_thumbs_down"),
    ]
    if settings.include_message_text:
        cols.extend([F.col("question"), F.col("answer")])  # opt-in raw content
    return calls.select(*cols)


def build_fact_room_activity_daily(fact_message: DataFrame) -> DataFrame:
    """Pre-aggregated room x day rollup — the table dashboards hit most."""
    return (
        fact_message.groupBy("room_id", "date_key")
        .agg(
            F.count("*").alias("message_count"),
            F.sum(F.col("is_ai_answer").cast("int")).alias("ai_answer_count"),
            F.countDistinct("sender_id").alias("distinct_sender_count"),
            F.sum("word_count").alias("total_words"),
        )
    )


def _write_gold(df: DataFrame, name: str) -> int:
    path = str(settings.gold_dir / name)
    df.write.mode("overwrite").parquet(path)
    return df.count()


def run() -> dict[str, int]:
    settings.ensure_dirs()
    print(f"[transform] Spark master={settings.spark_master}")
    spark = build_spark()
    spark.sparkContext.setLogLevel("WARN")
    counts: dict[str, int] = {}
    try:
        dim_user = build_dim_user(spark)
        dim_room = build_dim_room(spark)
        fact_message = build_fact_message(spark).cache()
        fact_ai_call = build_fact_ai_call(spark).cache()
        dim_date = build_dim_date([fact_message, fact_ai_call])
        fact_daily = build_fact_room_activity_daily(fact_message)

        counts["dim_date"] = _write_gold(dim_date, "dim_date")
        counts["dim_user"] = _write_gold(dim_user, "dim_user")
        counts["dim_room"] = _write_gold(dim_room, "dim_room")
        counts["fact_message"] = _write_gold(fact_message, "fact_message")
        counts["fact_ai_call"] = _write_gold(fact_ai_call, "fact_ai_call")
        counts["fact_room_activity_daily"] = _write_gold(fact_daily, "fact_room_activity_daily")

        for table, n in counts.items():
            print(f"  {table:<28} {n:>6} rows ➜ gold/{table}")
    finally:
        spark.stop()

    print(f"[transform] done — {len(counts)} gold tables")
    return counts


if __name__ == "__main__":
    run()

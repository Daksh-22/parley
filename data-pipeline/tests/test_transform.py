"""Unit tests for the Spark transform — run with: pytest data-pipeline/tests

These exercise the derived-metric logic on a tiny in-memory bronze fixture, so
they need no MongoDB and no warehouse — just pyspark (local mode). They guard
the column contract that the DDL and loader depend on.
"""

from __future__ import annotations

import json

import pytest

pyspark = pytest.importorskip("pyspark")
from pyspark.sql import SparkSession  # noqa: E402

from spark import transform  # noqa: E402


@pytest.fixture(scope="module")
def spark():
    # Same JDK auto-detection the pipeline uses, so tests run on Java 17 even
    # when the system default is a Spark-incompatible JDK (21/25).
    transform._ensure_compatible_java()
    s = (
        SparkSession.builder.master("local[1]")
        .appName("parley-transform-tests")
        .config("spark.sql.shuffle.partitions", "1")
        .getOrCreate()
    )
    yield s
    s.stop()


def test_json_len_counts_array_elements(spark):
    # citations is stored as a JSON-array string; citation_count must reflect it.
    df = spark.createDataFrame(
        [(json.dumps([{"a": 1}, {"b": 2}, {"c": 3}]),), (None,), ("not json",)],
        ["citations"],
    )
    out = df.select(transform._json_len("citations").alias("n")).collect()
    assert [r["n"] for r in out] == [3, 0, 0]


def test_fact_message_derived_metrics(spark, tmp_path, monkeypatch):
    # Point the transform at a temp bronze dir holding one messages snapshot.
    # Settings is a frozen dataclass, so build a patched copy and swap the
    # reference the transform module imported.
    import dataclasses

    from config.settings import settings as cfg

    patched = dataclasses.replace(cfg, bronze_dir=tmp_path, include_message_text=False)
    monkeypatch.setattr(transform, "settings", patched)

    rows = [
        {
            "id": "m1",
            "roomId": "r1",
            "senderId": "u1",
            "body": "hello world foo",
            "kind": "user",
            "citations": None,
            "aiQuestion": None,
            "createdAt": "2025-06-01T10:00:00+00:00",
            "updatedAt": "2025-06-01T10:00:00+00:00",
        },
        {
            "id": "m2",
            "roomId": "r1",
            "senderId": "u2",
            "body": "the decision was made",
            "kind": "ai",
            "citations": json.dumps([{"messageId": "m1"}]),
            "aiQuestion": "what was decided?",
            "createdAt": "2025-06-01T11:00:00+00:00",
            "updatedAt": "2025-06-01T11:00:00+00:00",
        },
    ]
    spark.createDataFrame(rows).write.mode("overwrite").parquet(str(tmp_path / "messages.parquet"))

    fact = transform.build_fact_message(spark)
    by_id = {r["message_id"]: r for r in fact.collect()}

    assert by_id["m1"]["word_count"] == 3
    assert by_id["m1"]["is_ai_answer"] is False
    assert by_id["m1"]["has_citations"] is False
    assert by_id["m1"]["citation_count"] == 0

    assert by_id["m2"]["is_ai_answer"] is True
    assert by_id["m2"]["has_citations"] is True
    assert by_id["m2"]["citation_count"] == 1
    assert by_id["m2"]["has_ai_question"] is True
    # privacy: raw body is not carried into the fact by default.
    assert "body" not in by_id["m2"]


def test_dedup_keeps_latest(spark):
    df = spark.createDataFrame(
        [
            ("x", "old", "2025-01-01T00:00:00+00:00"),
            ("x", "new", "2025-02-01T00:00:00+00:00"),
        ],
        ["id", "val", "updatedAt"],
    )
    out = transform._dedup_latest(df).collect()
    assert len(out) == 1
    assert out[0]["val"] == "new"

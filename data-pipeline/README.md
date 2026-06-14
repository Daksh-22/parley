# Parley Data Platform

A production-style analytics pipeline over Parley's data: **Python ETL → Apache
Spark → Snowflake**, modeled as a Kimball star schema and runnable end-to-end on
a laptop.

Parley's thesis is *"a chat app already holds the team's collective memory."*
This platform turns that memory into measurable signal — token spend, answer
quality, retrieval health, room engagement — without ever copying conversation
content into the warehouse.

```
 MongoDB (Parley)        Python ETL            Apache Spark           Warehouse
┌────────────────┐     ┌────────────┐        ┌──────────────┐      ┌──────────────┐
│ users  rooms   │     │ extract.py │ bronze │ transform.py │ gold │ Snowflake    │
│ messages       │ ──▶ │  pymongo   │ ─────▶ │  PySpark     │ ───▶ │   (prod)     │
│ memberships    │     │  + PII     │ parquet│  star schema │parquet│  · or ·     │
│ aicalls  ...   │     │  redaction │        │ dims + facts │      │ DuckDB(local)│
└────────────────┘     └────────────┘        └──────────────┘      └──────────────┘
        source            EXTRACT              TRANSFORM               LOAD
```

## Why this strengthens the project

| Capability it adds | Backed by |
| --- | --- |
| **Cost observability** — daily AI token spend by provider/model, cache-hit rate | `fact_ai_call` |
| **Quality flywheel** — thumbs up/down rate per answer kind, does grounding correlate with quality | `fact_ai_call.verdict`, `source_count` |
| **Engagement analytics** — most active rooms, channels vs DMs, sender diversity | `fact_room_activity_daily` |
| **Growth/cohorts** — signups by month, first-week activity | `dim_user`, `dim_date` |
| **Scale story** — same code runs `local[*]` or on a Spark cluster | `spark/transform.py` |
| **Governance** — secrets projected out at extract; conversation text excluded by default | `config.PROJECT_OUT`, `INCLUDE_MESSAGE_TEXT` |

## Architecture (medallion)

- **Bronze** (`data/bronze/`) — faithful 1:1 Parquet snapshot of each MongoDB
  collection. `_id` → string `id`; nested arrays kept as JSON. Password/token
  hashes are **projected out at the query level** so they never touch disk.
  Extraction is **incremental** — it watermarks on `updatedAt`.
- **Gold** (`data/gold/`) — the curated star schema, built by Spark:
  - **Dimensions:** `dim_date`, `dim_user`, `dim_room`
  - **Facts:** `fact_message` (grain: one message), `fact_ai_call` (one AI call),
    `fact_room_activity_daily` (one room × day rollup)
- **Warehouse** — the gold tables loaded into Snowflake (production) or a local
  DuckDB file (default, zero setup). Identical table names and SQL on both
  (DuckDB uses the default schema; on Snowflake `USE SCHEMA PARLEY.ANALYTICS`).

## Quickstart (no cloud account needed)

From the `data-pipeline/` directory, with the Parley MongoDB running
(`docker compose up -d` in the repo root):

```bash
cd data-pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # defaults: local Mongo + local DuckDB
python pipeline.py              # extract -> transform -> load
```

> **Java for Spark:** Spark 3.5 needs Java 8/11/17. If `java -version` shows
> something newer (21/25), run `make jdk` once — it drops a compatible JDK 17
> into `.jdk17/`, which the transform auto-detects (no `JAVA_HOME` juggling).
> Already have a compatible JDK? Set `PARLEY_JAVA_HOME` to it instead.

Then explore the warehouse (no DuckDB CLI needed — uses the Python package):

```bash
python query.py        # runs sql/analytics_queries.sql, prints each result
```

> Tip: `pnpm seed:demo` in the repo root first, so there's data to analyze.

## Switching to Snowflake

Set these in `.env` and the same `python pipeline.py` loads to Snowflake
instead — the loader applies `warehouse/snowflake_schema.sql`, then ships each
gold table with `write_pandas` (truncate-and-replace):

```bash
WAREHOUSE_TARGET=snowflake
SNOWFLAKE_ACCOUNT=ab12345.us-east-1
SNOWFLAKE_USER=...
SNOWFLAKE_PASSWORD=...
SNOWFLAKE_DATABASE=PARLEY
SNOWFLAKE_SCHEMA=ANALYTICS
```

## Running on a real Spark cluster

`local[*]` uses every core on your machine — fine up to millions of rows. To
demonstrate distributed execution:

```bash
docker compose -f docker-compose.spark.yml up -d
SPARK_MASTER=spark://localhost:7077 python pipeline.py --steps transform
# Spark UI: http://localhost:8080
```

## Scheduling

`dags/parley_warehouse_dag.py` is an Airflow DAG (extract → transform → load,
daily at 02:00 UTC, incremental). Point `AIRFLOW__CORE__DAGS_FOLDER` at
`data-pipeline/dags`, or just cron `python pipeline.py`.

## Commands

| Command | Does |
| --- | --- |
| `python pipeline.py` | full pipeline (extract → transform → load) |
| `python pipeline.py --steps extract` | one stage; stages are decoupled via Parquet |
| `python pipeline.py --full-refresh` | ignore the watermark, re-extract everything |
| `make test` | pytest the Spark transform (no Mongo/warehouse needed) |
| `make query` | run the example analytics against DuckDB |

Everything is also available via the `Makefile` (`make help`).

## Privacy & security

- `users.passwordHash`, `pats.tokenHash`, `invites.tokenHash` are dropped at
  extract — they are never written anywhere.
- Message bodies and AI question/answer text are **not** carried into the gold
  layer unless `INCLUDE_MESSAGE_TEXT=true`. The warehouse stores derived metrics
  (length, word count, citation count), not what people said — consistent with
  Parley's per-room memory stance.
- `.env`, `data/`, and `*.duckdb` are git-ignored.

## Notes & limitations

- Deletes: the source has no soft-delete column, so incremental runs detect
  inserts/updates (via `updatedAt`) but not hard deletes. Use
  `--full-refresh` periodically, or add oplog/CDC, if deletion accuracy matters.
- The gold layer is current-state (latest row per `id`); it is not a slowly
  changing dimension. Add SCD-2 on `dim_user`/`dim_room` if you need history.

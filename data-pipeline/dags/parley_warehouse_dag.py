"""Airflow DAG — schedule the Parley warehouse refresh.

Drop this file in your Airflow `dags/` folder (or set AIRFLOW__CORE__DAGS_FOLDER
to data-pipeline/dags). It runs the three stages as separate tasks so a failed
load can be retried without re-extracting, and so each stage's duration is
visible in the Airflow UI.

Scheduling is daily at 02:00 UTC by default; adjust `schedule` to taste. The
extract task runs incrementally (watermark-based), so daily runs stay cheap.

This import is optional — the pipeline runs fine without Airflow via
`python pipeline.py`. apache-airflow is commented out in requirements.txt.
"""

from __future__ import annotations

import pendulum

try:
    from airflow.decorators import dag, task
except ImportError as exc:  # pragma: no cover - only when airflow absent
    raise ImportError(
        "apache-airflow is not installed. Uncomment it in requirements.txt "
        "and `pip install apache-airflow` to use this DAG, or run the pipeline "
        "directly with `python pipeline.py`."
    ) from exc


@dag(
    dag_id="parley_warehouse_refresh",
    schedule="0 2 * * *",  # daily 02:00 UTC
    start_date=pendulum.datetime(2025, 1, 1, tz="UTC"),
    catchup=False,
    default_args={"retries": 2, "retry_delay": pendulum.duration(minutes=5)},
    tags=["parley", "etl", "spark", "snowflake"],
)
def parley_warehouse_refresh():
    @task()
    def extract() -> dict:
        from etl import extract as e

        return e.run()

    @task()
    def transform() -> dict:
        from spark import transform as t

        return t.run()

    @task()
    def load() -> dict:
        from warehouse import load as l

        return l.run()

    # extract ➜ transform ➜ load (linear dependency).
    transform_done = transform()
    extract() >> transform_done >> load()


dag_instance = parley_warehouse_refresh()

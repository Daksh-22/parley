"""Parley data platform — orchestrator CLI.

Runs the medallion pipeline end to end, or any subset of stages:

    extract    MongoDB        ➜ bronze Parquet      (Python / pymongo)
    transform  bronze Parquet ➜ gold star schema    (Spark / PySpark)
    load       gold Parquet   ➜ Snowflake | DuckDB  (warehouse loader)

Examples:
    python pipeline.py                      # all three stages
    python pipeline.py --steps extract      # just pull from Mongo
    python pipeline.py --steps transform,load
    python pipeline.py --full-refresh       # ignore the incremental watermark

The stages are decoupled through the Parquet lakehouse: you can re-run the
Spark transform repeatedly without re-hitting Mongo, and re-load the warehouse
without re-running Spark.
"""

from __future__ import annotations

import sys
import time

import click

from config.settings import settings

ALL_STEPS = ("extract", "transform", "load")


@click.command()
@click.option(
    "--steps",
    default=",".join(ALL_STEPS),
    help="Comma-separated subset of: extract,transform,load (default: all).",
)
@click.option(
    "--full-refresh",
    is_flag=True,
    help="Ignore the incremental watermark and re-extract every document.",
)
def main(steps: str, full_refresh: bool) -> None:
    requested = [s.strip() for s in steps.split(",") if s.strip()]
    unknown = [s for s in requested if s not in ALL_STEPS]
    if unknown:
        raise click.BadParameter(f"unknown step(s): {', '.join(unknown)}")

    settings.validate()
    print("=" * 64)
    print(f"Parley data platform — steps: {', '.join(requested)}")
    print(f"  source : {settings.mongo_uri}")
    print(f"  target : {settings.warehouse_target}")
    print("=" * 64)

    started = time.perf_counter()

    if "extract" in requested:
        from etl import extract

        extract.run(full_refresh=full_refresh)

    if "transform" in requested:
        from spark import transform

        transform.run()

    if "load" in requested:
        from warehouse import load

        load.run()

    elapsed = time.perf_counter() - started
    print("=" * 64)
    print(f"Pipeline complete in {elapsed:.1f}s")
    print("=" * 64)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)

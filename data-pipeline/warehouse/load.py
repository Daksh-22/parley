"""Load — gold Parquet ➜ warehouse.

Two targets, selected by WAREHOUSE_TARGET:

  snowflake  Production. Applies warehouse/snowflake_schema.sql, then loads each
             gold table with write_pandas (truncate-and-replace each run).
  duckdb     Local default. Loads gold straight into a DuckDB file via
             read_parquet — zero cloud setup, same star schema, Snowflake-ish
             SQL — so the pipeline is demoable end to end on a laptop.

Run standalone:  python -m warehouse.load
"""

from __future__ import annotations

from pathlib import Path

import pyarrow.parquet as pq

from config.settings import settings

_SCHEMA_SQL = Path(__file__).resolve().parent / "snowflake_schema.sql"


def _gold_table_dirs() -> list[tuple[str, Path]]:
    """(table_name, parquet_dir) for every gold table that was produced."""
    out: list[tuple[str, Path]] = []
    for name in settings.gold_tables:
        path = settings.gold_dir / name
        if path.exists():
            out.append((name, path))
        else:
            print(f"  [skip] gold/{name} not found — did transform run?")
    return out


# --- DuckDB target (local, no account) -------------------------------------
def load_duckdb() -> dict[str, int]:
    import duckdb

    print(f"[load] duckdb ➜ {settings.duckdb_path}")
    settings.duckdb_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(settings.duckdb_path))
    counts: dict[str, int] = {}
    try:
        # Tables live in the default (main) schema so sql/analytics_queries.sql
        # runs verbatim — the same unqualified names work on Snowflake once you
        # USE SCHEMA PARLEY.ANALYTICS.
        for name, path in _gold_table_dirs():
            glob = str(path / "*.parquet")
            con.execute(
                f"CREATE OR REPLACE TABLE {name} AS "
                f"SELECT * FROM read_parquet('{glob}');"
            )
            n = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            counts[name] = n
            print(f"  {name:<28} {n:>6} rows")
    finally:
        con.close()
    print(f"[load] done — {len(counts)} tables in {settings.duckdb_path.name}")
    return counts


# --- Snowflake target (production) -----------------------------------------
def _connect_snowflake():
    import snowflake.connector

    return snowflake.connector.connect(
        account=settings.sf_account,
        user=settings.sf_user,
        password=settings.sf_password,
        role=settings.sf_role,
        warehouse=settings.sf_warehouse,
    )


def _apply_schema(conn) -> None:
    # Use the connector's own multi-statement parser rather than hand-splitting
    # on ';'. A naive split skips any statement whose chunk begins with a
    # leading '--' comment (it would drop CREATE WAREHOUSE and several CREATE
    # TABLEs here), and mishandles semicolons inside comments/literals.
    sql = _SCHEMA_SQL.read_text()
    for cur in conn.execute_string(sql, remove_comments=False):
        cur.close()


def load_snowflake() -> dict[str, int]:
    from snowflake.connector.pandas_tools import write_pandas

    print(f"[load] snowflake ➜ {settings.sf_database}.{settings.sf_schema}")
    counts: dict[str, int] = {}
    conn = _connect_snowflake()
    try:
        # snowflake_schema.sql already ends with USE SCHEMA PARLEY.ANALYTICS,
        # so the connection is positioned in the target schema after this.
        _apply_schema(conn)

        for name, path in _gold_table_dirs():
            df = pq.read_table(path).to_pandas()
            # Snowflake DDL uses unquoted (uppercase) identifiers; match them.
            df.columns = [c.upper() for c in df.columns]
            success, _, nrows, _ = write_pandas(
                conn,
                df,
                table_name=name.upper(),
                database=settings.sf_database,
                schema=settings.sf_schema,
                overwrite=True,            # truncate-and-replace each run
                quote_identifiers=True,
            )
            if not success:
                raise RuntimeError(f"write_pandas failed for {name}")
            counts[name] = nrows
            print(f"  {name:<28} {nrows:>6} rows")
    finally:
        conn.close()
    print(f"[load] done — {len(counts)} tables in Snowflake")
    return counts


def run() -> dict[str, int]:
    settings.validate()
    if settings.warehouse_target == "snowflake":
        return load_snowflake()
    return load_duckdb()


if __name__ == "__main__":
    run()

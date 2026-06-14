"""Run the example analytics against the local DuckDB warehouse.

A no-install alternative to the DuckDB CLI: reads sql/analytics_queries.sql,
strips comments, and prints each query's result as a table. Used by
`make query`.

    python query.py                       # all queries in analytics_queries.sql
    python query.py sql/analytics_queries.sql   # an explicit file

For Snowflake, run the same SQL in a Snowflake worksheet after
`USE SCHEMA PARLEY.ANALYTICS`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import duckdb

from config.settings import settings

_DEFAULT_SQL = Path(__file__).resolve().parent / "sql" / "analytics_queries.sql"


def _statements(sql_text: str) -> list[str]:
    # Strip -- line comments first so a semicolon inside a comment can't be
    # mistaken for a statement terminator, then split on ';'.
    no_comments = re.sub(r"--[^\n]*", "", sql_text)
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def main() -> None:
    sql_path = Path(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_SQL
    if not settings.duckdb_path.exists():
        raise SystemExit(
            f"No warehouse at {settings.duckdb_path}. Run the pipeline first: python pipeline.py"
        )

    statements = _statements(sql_path.read_text())
    con = duckdb.connect(str(settings.duckdb_path), read_only=True)
    try:
        for i, stmt in enumerate(statements, 1):
            df = con.execute(stmt).df()
            print(f"\n===== query {i} ({len(df)} rows) =====")
            print(df.to_string(index=False))
    finally:
        con.close()


if __name__ == "__main__":
    main()

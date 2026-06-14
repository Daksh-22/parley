"""Central configuration for the Parley data platform.

Reads from environment (.env supported via python-dotenv), mirroring the
validate-at-boot style of the Node server's apps/server/src/config/env.ts.
Importing this module is the single source of truth for every path, credential,
and toggle the ETL / Spark / warehouse layers need.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env sitting next to this package (data-pipeline/.env), if present.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _path(name: str, default: str) -> Path:
    return Path(os.getenv(name, default)).expanduser().resolve()


# The 8 MongoDB collections the Parley server writes (Mongoose default
# pluralization). password fields are projected out at extract time.
SOURCE_COLLECTIONS: tuple[str, ...] = (
    "users",
    "rooms",
    "messages",
    "memberships",
    "aicalls",
    "documents",
    "invites",
    "pats",
)

# Fields that must never reach the lakehouse. user.passwordHash has no
# select:false in the schema, so a naive find() returns it — we project it out
# explicitly. pats/invites carry token hashes; drop those too.
PROJECT_OUT: dict[str, tuple[str, ...]] = {
    "users": ("passwordHash",),
    "pats": ("tokenHash",),
    "invites": ("tokenHash",),
}


@dataclass(frozen=True)
class Settings:
    # Source
    mongo_uri: str = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/parley")
    mongo_db: str = os.getenv("MONGO_DB", "parley")

    # Lakehouse
    data_dir: Path = _path("DATA_DIR", "./data")
    bronze_dir: Path = _path("BRONZE_DIR", "./data/bronze")
    gold_dir: Path = _path("GOLD_DIR", "./data/gold")
    watermark_file: Path = _path("WATERMARK_FILE", "./data/_state/watermark.json")
    full_refresh: bool = _bool("FULL_REFRESH", False)

    # Privacy
    include_message_text: bool = _bool("INCLUDE_MESSAGE_TEXT", False)

    # Warehouse
    warehouse_target: str = os.getenv("WAREHOUSE_TARGET", "duckdb").strip().lower()
    duckdb_path: Path = _path("DUCKDB_PATH", "./data/warehouse.duckdb")

    # Snowflake
    sf_account: str = os.getenv("SNOWFLAKE_ACCOUNT", "")
    sf_user: str = os.getenv("SNOWFLAKE_USER", "")
    sf_password: str = os.getenv("SNOWFLAKE_PASSWORD", "")
    sf_role: str = os.getenv("SNOWFLAKE_ROLE", "ACCOUNTADMIN")
    sf_warehouse: str = os.getenv("SNOWFLAKE_WAREHOUSE", "PARLEY_WH")
    sf_database: str = os.getenv("SNOWFLAKE_DATABASE", "PARLEY")
    sf_schema: str = os.getenv("SNOWFLAKE_SCHEMA", "ANALYTICS")

    # Spark
    spark_master: str = os.getenv("SPARK_MASTER", "local[*]")
    spark_app_name: str = os.getenv("SPARK_APP_NAME", "parley-transform")

    # The curated tables the transform produces and the loader ships, in
    # dependency order (dims before facts is not required for parquet, but the
    # loader uses this list to know what to create/load).
    gold_tables: tuple[str, ...] = field(
        default=(
            "dim_date",
            "dim_user",
            "dim_room",
            "fact_message",
            "fact_ai_call",
            "fact_room_activity_daily",
        )
    )

    def validate(self) -> None:
        """Fail fast with a clear message, like the server does at boot."""
        problems: list[str] = []
        if self.warehouse_target not in {"snowflake", "duckdb"}:
            problems.append(
                f"WAREHOUSE_TARGET must be 'snowflake' or 'duckdb', got '{self.warehouse_target}'"
            )
        if self.warehouse_target == "snowflake":
            for key in ("sf_account", "sf_user", "sf_password"):
                if not getattr(self, key):
                    problems.append(
                        f"SNOWFLAKE_{key.removeprefix('sf_').upper()} is required when WAREHOUSE_TARGET=snowflake"
                    )
        if problems:
            raise SystemExit(
                "Invalid data-pipeline configuration:\n  - "
                + "\n  - ".join(problems)
                + "\nSee data-pipeline/.env.example for the expected variables."
            )

    def ensure_dirs(self) -> None:
        for p in (self.data_dir, self.bronze_dir, self.gold_dir, self.watermark_file.parent):
            p.mkdir(parents=True, exist_ok=True)


settings = Settings()

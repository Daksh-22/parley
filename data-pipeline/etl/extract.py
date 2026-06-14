"""Extract — MongoDB ➜ bronze Parquet.

The bronze layer is a faithful, typed, 1:1 snapshot of each source collection
with two deviations, both deliberate:

  1. Secret fields (password / token hashes) are projected out at the query
     level so they never touch disk. See config.PROJECT_OUT.
  2. ObjectIds and nested values are JSON-normalized to strings/primitives so
     Parquet (and downstream Spark) get a stable, columnar-friendly shape.

Extraction is incremental: each collection with an `updatedAt` field is pulled
with a `updatedAt > watermark` filter, and the max `updatedAt` seen is saved as
the new watermark. Collections without timestamps are snapshotted in full.

Run standalone:  python -m etl.extract
Or via the orchestrator:  python pipeline.py --steps extract
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

import pyarrow as pa
import pyarrow.parquet as pq
from bson import ObjectId
from pymongo import MongoClient

from config.settings import PROJECT_OUT, SOURCE_COLLECTIONS, settings

# Collections that carry Mongoose timestamps and so support incremental pulls.
# (documents/invites/pats also have timestamps:true; messages/aicalls too.)
_TIMESTAMPED = {
    "users",
    "rooms",
    "messages",
    "memberships",
    "aicalls",
    "documents",
    "invites",
    "pats",
}


def _load_watermarks(full_refresh: bool) -> dict[str, str]:
    if full_refresh or not settings.watermark_file.exists():
        return {}
    try:
        return json.loads(settings.watermark_file.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_watermarks(watermarks: dict[str, str]) -> None:
    settings.watermark_file.parent.mkdir(parents=True, exist_ok=True)
    settings.watermark_file.write_text(json.dumps(watermarks, indent=2, sort_keys=True))


def _jsonable(value: Any) -> Any:
    """Coerce BSON/Mongo types into Parquet-friendly primitives."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        # Normalize to timezone-aware UTC ISO-8601 so Spark parses it cleanly.
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return value


def _flatten_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """One bronze row. _id ➜ string `id`; nested citations/sourceKeys ➜ JSON text.

    Keeping array/object columns as JSON strings means the bronze schema is flat
    and stable across documents (Mongo is schemaless); Spark re-parses the few
    columns it actually needs in the transform step.
    """
    out: dict[str, Any] = {}
    for key, val in doc.items():
        if key == "_id":
            out["id"] = str(val)
            continue
        val = _jsonable(val)
        if isinstance(val, (list, dict)):
            out[key] = json.dumps(val, separators=(",", ":"))
        else:
            out[key] = val
    return out


def _rows_to_table(rows: list[dict[str, Any]]) -> pa.Table:
    # Union the keys across rows so a missing optional field becomes a null
    # column rather than dropping. Mongo docs are schemaless; bronze is not.
    columns: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                columns.append(k)
    data = {c: [r.get(c) for r in rows] for c in columns}
    return pa.table(data)


def extract_collection(
    client: MongoClient, name: str, watermarks: dict[str, str], full_refresh: bool
) -> int:
    """Pull one collection to bronze/<name>.parquet. Returns row count written."""
    db = client[settings.mongo_db]
    coll = db[name]

    projection = {f: 0 for f in PROJECT_OUT.get(name, ())}
    query: dict[str, Any] = {}

    prev_wm = watermarks.get(name)
    if name in _TIMESTAMPED and prev_wm and not full_refresh:
        query["updatedAt"] = {"$gt": datetime.fromisoformat(prev_wm)}

    cursor: Iterable[dict[str, Any]] = coll.find(query, projection or None)

    rows: list[dict[str, Any]] = []
    max_updated: datetime | None = None
    for doc in cursor:
        updated = doc.get("updatedAt")
        if isinstance(updated, datetime):
            u = updated if updated.tzinfo else updated.replace(tzinfo=timezone.utc)
            if max_updated is None or u > max_updated:
                max_updated = u
        rows.append(_flatten_doc(doc))

    out_path = settings.bronze_dir / f"{name}.parquet"

    if not rows:
        # Incremental run with nothing new: leave any existing snapshot intact.
        print(f"  {name:<12} no new documents")
        return 0

    table = _rows_to_table(rows)

    if name in _TIMESTAMPED and prev_wm and out_path.exists() and not full_refresh:
        # Append-merge: union existing bronze with the new slice. The transform
        # step dedups by id (latest wins) so an upsert here is not required.
        existing = pq.read_table(out_path)
        table = pa.concat_tables([existing, table], promote_options="default")

    pq.write_table(table, out_path)

    if max_updated is not None:
        watermarks[name] = max_updated.isoformat()

    print(f"  {name:<12} {len(rows):>6} rows ➜ {out_path.name}")
    return len(rows)


def run(full_refresh: bool | None = None) -> dict[str, int]:
    """Extract every source collection. Returns {collection: rows_written}.

    full_refresh: when None, falls back to settings.full_refresh (the .env
    value). The orchestrator passes the --full-refresh CLI flag explicitly so
    it is not lost to import-time config capture.
    """
    fr = settings.full_refresh if full_refresh is None else full_refresh
    settings.ensure_dirs()
    mode = "FULL REFRESH" if fr else "incremental"
    print(f"[extract] {settings.mongo_uri} ({mode})")

    watermarks = _load_watermarks(fr)
    counts: dict[str, int] = {}

    client: MongoClient = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=10_000)
    try:
        client.admin.command("ping")  # fail fast with a clear error if unreachable
        for name in SOURCE_COLLECTIONS:
            counts[name] = extract_collection(client, name, watermarks, fr)
    finally:
        client.close()

    _save_watermarks(watermarks)
    total = sum(counts.values())
    print(f"[extract] done — {total} rows across {len(counts)} collections")
    return counts


if __name__ == "__main__":
    run()

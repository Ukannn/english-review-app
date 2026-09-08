#!/usr/bin/env python3
"""Read-only owner, empty-target and resumable-batch checks before a cutover import."""
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from db import add_connection_arguments, run_sql
from reconcile_english_import import TABLES
from validation import LIVE_ONLY_TABLES


def assess(manifest, payload):
    owner = str(uuid.UUID(manifest["ownerId"]))
    batch = str(uuid.UUID(manifest["batchId"]))
    owner_ok = payload["registeredOwner"] == owner and payload["authOwnerExists"] and payload["authUserCount"] == 1
    empty = not any(payload["tableCounts"].values())
    previous = payload["batches"]
    matching = len(previous) == 1 and previous[0]["id"] == batch and previous[0]["ownerId"] == owner \
        and previous[0]["snapshotHash"] == manifest["sourceSnapshotHash"] \
        and previous[0]["planHash"] == manifest["staged"]["planHash"]
    state = "blocked"
    if owner_ok and empty and not previous:
        state = "ready"
    elif owner_ok and empty and matching and previous[0]["status"] == "staged":
        state = "resumable"
    elif owner_ok and matching and previous[0]["status"] == "promoted":
        state = "already_promoted_reconcile_required"
    return {"ok": state in ("ready", "resumable"), "state": state, "ownerRegistered": owner_ok,
            "businessTablesEmpty": empty, "tableCounts": payload["tableCounts"], "batches": previous}


def preflight(args, manifest):
    owner = str(uuid.UUID(manifest["ownerId"]))
    tables = sorted(set(manifest["targetIds"]) | LIVE_ONLY_TABLES)
    for table in tables:
        if table not in LIVE_ONLY_TABLES and (not table.startswith("english_private.") or table.removeprefix("english_private.") not in TABLES):
            raise ValueError("Unknown target table")
    # Count all rows, including unexpected owners. This is a new single-owner database.
    counts = ",".join(f"'{table}',(select count(*) from {table})" for table in tables)
    sql = f"""select jsonb_build_object(
 'registeredOwner',(select owner_id from english_private.app_owner where singleton),
 'authOwnerExists',exists(select 1 from auth.users where id='{owner}'),
 'authUserCount',(select count(*) from auth.users),
 'tableCounts',jsonb_build_object({counts}),
 'batches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'ownerId',owner_id,'status',status,
 'snapshotHash',snapshot_sha256,'planHash',reconciliation->'staging'->>'planHash')),'[]'::jsonb)
 from english_private.import_batches));"""
    result = assess(manifest, json.loads(run_sql(args, sql)))
    result.update(sourceState=manifest.get("sourceState", "rehearsal"), sourceFrozenAt=manifest.get("sourceFrozenAt"),
                  projectRef=getattr(args, "project_ref", None), snapshotSha256=manifest["sourceSnapshotHash"],
                  checkedAt=datetime.now(timezone.utc).isoformat())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    add_connection_arguments(parser)
    args = parser.parse_args()
    result = preflight(args, json.loads(args.manifest.read_text()))
    print(json.dumps(result))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

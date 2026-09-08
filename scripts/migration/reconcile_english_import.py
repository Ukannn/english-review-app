#!/usr/bin/env python3
"""Read back every raw row, formula, target identity and dynamic source count."""
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from db import add_connection_arguments, run_sql
from export_xlsx_snapshot import canonical_hash

TABLES = {"settings", "source_notes", "contexts", "candidates", "candidate_generation_rows", "phrases",
          "daily_queues", "daily_queue_items", "sessions", "question_attempts", "questions", "answer_drafts",
          "answer_draft_history", "submissions", "grade_requests", "grade_result_attempts", "commit_journal",
          "review_events", "error_events", "context_candidates", "legacy_recovery", "import_rows"}
READBACK_PAGE_BYTES = 240 * 1024


def read_raw_rows(args, owner, batch):
    """Keyset pages are also size-bounded, because some journal rows are large."""
    rows, cursor, pages, largest = [], None, 0, 0
    while True:
        after = f"and id > '{str(uuid.UUID(cursor))}'" if cursor else ""
        query = f"""with source as materialized (
 select id,jsonb_build_object('source_sheet',source_sheet,'source_row',source_row,
 'raw_json_text',raw_json::text,'row_hash',row_hash,'formula_cells_text',formula_cells::text,
 'target_table',target_table,'target_id',target_id) as payload
 from english_private.import_rows where owner_id='{owner}' and import_batch_id='{batch}' {after}
 order by id limit 200
), sized as (
 select id,payload,row_number() over(order by id) as position,
 sum(octet_length(payload::text)) over(order by id) as running_bytes from source
), page as (select * from sized where running_bytes <= {READBACK_PAGE_BYTES} or position=1)
select jsonb_build_object('rows',coalesce((select jsonb_agg(payload order by id) from page),'[]'::jsonb),
 'lastId',(select id from page order by id desc limit 1),
 'payloadBytes',coalesce((select sum(octet_length(payload::text)) from page),0));"""
        payload = json.loads(run_sql(args, query))
        if not isinstance(payload.get("rows"), list) or len(payload["rows"]) > 200:
            raise ValueError("Unexpected raw-row reconciliation page")
        if not payload["rows"]:
            if payload["lastId"] is not None:
                raise ValueError("Empty reconciliation page has a cursor")
            break
        next_cursor = str(uuid.UUID(payload["lastId"]))
        if cursor and next_cursor <= cursor:
            raise ValueError("Reconciliation cursor did not advance")
        # The Management API/CLI decodes JSON numbers and can turn 15.0 into 15.
        # Transport database JSON as text to retain the source numeric spelling
        # used by the snapshot hash; do not weaken the comparison or rewrite data.
        for row in payload["rows"]:
            row["raw_json"] = json.loads(row.pop("raw_json_text"))
            row["formula_cells"] = json.loads(row.pop("formula_cells_text"))
        rows.extend(payload["rows"])
        cursor = next_cursor
        pages += 1
        largest = max(largest, payload["payloadBytes"])
    return rows, {"rawReadbackPages": pages, "largestRawPageBytes": largest}


def read_target_ids(args, owner, tables):
    result = {}
    for table in tables:
        if table.removeprefix("english_private.") not in TABLES or not table.startswith("english_private."):
            raise ValueError("Unknown manifest target table")
        found, cursor = [], None
        while True:
            after = f"and id > '{str(uuid.UUID(cursor))}'" if cursor else ""
            sql = f"""select coalesce(jsonb_agg(id::text order by id),'[]'::jsonb)
 from (select id from {table} where owner_id='{owner}' {after} order by id limit 2000) page;"""
            page = json.loads(run_sql(args, sql))
            if not isinstance(page, list) or len(page) > 2000:
                raise ValueError("Unexpected identity reconciliation page")
            ids = [str(uuid.UUID(value)) for value in page]
            if ids != sorted(set(ids)) or (cursor and ids and ids[0] <= cursor):
                raise ValueError("Identity reconciliation cursor did not advance")
            found.extend(ids)
            if len(ids) < 2000:
                break
            cursor = ids[-1]
        result[table] = found
    return result


def compare_rows(manifest, actual_rows, actual_ids):
    expected = {(r["sourceSheet"], r["sourceRow"]): r for r in manifest["rawRows"]}
    seen, mismatches = set(), []
    for row in actual_rows:
        key = (row["source_sheet"], row["source_row"])
        target = expected.get(key)
        good = (key not in seen and target is not None and row["row_hash"] == target["rowHash"]
                and canonical_hash(row["raw_json"]) == target["rawHash"]
                and canonical_hash(row["formula_cells"]) == target["formulaHash"]
                and row["target_table"] == target["targetTable"] and row["target_id"] == target["targetId"])
        if not good:
            mismatches.append({"sheet": key[0], "row": key[1]})
        seen.add(key)
    missing = set(expected) - seen
    identity_mismatches = [table for table, ids in manifest["targetIds"].items()
                           if sorted(actual_ids.get(table, [])) != sorted(ids)]
    return {"ok": not mismatches and not missing and not identity_mismatches,
            "rawRowCount": len(actual_rows), "rawMismatchCount": len(mismatches), "missingRawRows": len(missing),
            "targetIdentityMismatches": identity_mismatches, "mismatchCoordinates": mismatches[:10]}


def reconcile(args, manifest):
    owner, batch = str(uuid.UUID(manifest["ownerId"])), str(uuid.UUID(manifest["batchId"]))
    sql = f"""select jsonb_build_object(
 'ownerRegistered',exists(select 1 from english_private.app_owner where singleton and owner_id='{owner}'),
 'batch',(select jsonb_build_object('status',status,'snapshotHash',snapshot_sha256,'sourceRows',expected_row_count,'formulas',expected_formula_count) from english_private.import_batches where owner_id='{owner}' and id='{batch}'),
 'legacyActive',(select count(*) from english_private.daily_queues where owner_id='{owner}' and status <> 'legacy') + (select count(*) from english_private.sessions where owner_id='{owner}' and status <> 'legacy_recovery')
);
"""
    payload = json.loads(run_sql(args, sql))
    raw_rows, readback = read_raw_rows(args, owner, batch)
    ids = read_target_ids(args, owner, sorted(manifest["targetIds"]))
    result = compare_rows(manifest, raw_rows, ids)
    result.update(readback)
    expected_batch = {"status": "promoted", "snapshotHash": manifest["sourceSnapshotHash"],
                      "sourceRows": manifest["sourceRows"], "formulas": manifest["sourceFormulas"]}
    result.update(batchId=batch, batchMatches=payload["batch"] == expected_batch,
                  ownerRegistered=payload["ownerRegistered"], activeLegacyCount=payload["legacyActive"])
    result.update(sourceState=manifest.get("sourceState", "rehearsal"),
                  projectRef=getattr(args, "project_ref", None), snapshotSha256=manifest["sourceSnapshotHash"],
                  checkedAt=datetime.now(timezone.utc).isoformat())
    result["ok"] = result["ok"] and result["batchMatches"] and result["ownerRegistered"] and not result["activeLegacyCount"]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    add_connection_arguments(parser)
    args = parser.parse_args()
    result = reconcile(args, json.loads(args.manifest.read_text()))
    print(json.dumps(result))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

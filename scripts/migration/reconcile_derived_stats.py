#!/usr/bin/env python3
"""Compare owner-scoped event aggregates with the final snapshot; report cache drift separately."""
import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from build_english_import import boolean, date_value, integer, phrase_for_review, text, timestamp_value
from db import add_connection_arguments, run_sql
from snapshot import load_snapshot


def expected_stats(sheets):
    phrases = {str(row["ID"]): str(row["ID"]) for row in sheets["Phrase Bank"]}
    expected = {key: {"id": key, "lastReviewedDate": None, "timesSeen": 0, "timesCorrect": 0} for key in phrases}
    for row in sheets["Review Log"]:
        key = phrase_for_review(row, {}, sheets, phrases)
        if key is None or boolean(row.get("Affects SRS?")) is not True:
            continue
        stats = expected[key]
        stats["timesSeen"] += 1
        stats["timesCorrect"] += int(row["Result"] in ("normal", "mastered"))
        reviewed = date_value(row["Date"])
        if reviewed and (stats["lastReviewedDate"] is None or reviewed > stats["lastReviewedDate"]):
            stats["lastReviewedDate"] = reviewed
    return expected


def compare_stats(expected, actual):
    actual_by_id = {row["id"]: row for row in actual}
    mismatches = [key for key, row in expected.items() if actual_by_id.get(key) != row]
    extras = set(actual_by_id) - set(expected)
    return {"ok": not mismatches and not extras, "phraseCount": len(expected),
            "mismatchCount": len(mismatches), "extraPhraseCount": len(extras)}


def expected_progress(sheets):
    result = {}
    for row in sheets["Phrase Bank"]:
        next_review = timestamp_value(row["Next Review"])
        result[str(row["ID"])] = {"id": str(row["ID"]), "reviewStage": integer(row["Review Stage"], 0),
            "nextReviewEpoch": datetime.fromisoformat(next_review.replace("Z", "+00:00")).timestamp() if next_review else None,
            "status": text(row["Status"]) or "active", "masteryStreak": integer(row["Mastery Streak"], 0),
            "lastResult": text(row["Last Result"])}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--owner-id", type=uuid.UUID, required=True)
    add_connection_arguments(parser)
    args = parser.parse_args()
    manifest, sheets, formulas = load_snapshot(args.snapshot)
    expected = expected_stats(sheets)
    owner = str(args.owner_id)
    query = f"""select coalesce(jsonb_agg(jsonb_build_object('id',p.legacy_phrase_id,
 'lastReviewedDate',(s.last_reviewed_at at time zone 'Asia/Shanghai')::date,
 'timesSeen',s.times_seen,'timesCorrect',s.times_correct) order by p.legacy_phrase_id),'[]'::jsonb)
from english_private.phrases p join english_private.phrase_review_stats s on s.phrase_id=p.id
where p.owner_id='{owner}' and p.legacy_phrase_id is not null;"""
    result = compare_stats(expected, json.loads(run_sql(args, query)))
    progress_query = f"""select coalesce(jsonb_agg(jsonb_build_object('id',legacy_phrase_id,
 'reviewStage',review_stage,'nextReviewEpoch',extract(epoch from next_review_at),
 'status',status,'masteryStreak',mastery_streak,'lastResult',last_result)
 order by legacy_phrase_id),'[]'::jsonb) from english_private.phrases
 where owner_id='{owner}' and legacy_phrase_id is not null;"""
    progress = compare_stats(expected_progress(sheets), json.loads(run_sql(args, progress_query)))
    result.update(historicalProgress=progress)
    result["ok"] = result["ok"] and progress["ok"]
    cache_drift = 0
    cache_missing = 0
    for row in sheets["Phrase Bank"]:
        if any(row[key] is None for key in ("Times Seen", "Times Correct")):
            cache_missing += 1
            continue
        cached = {"id": row["ID"], "lastReviewedDate": date_value(row["Last Reviewed"]),
                  "timesSeen": integer(row["Times Seen"], 0), "timesCorrect": integer(row["Times Correct"], 0)}
        cache_drift += int(cached != expected[row["ID"]])
    result.update(snapshotHash=manifest["snapshot_sha256"], legacyFormulaDriftCount=cache_drift,
                  missingCachedFormulaRows=cache_missing,
                  sourceState=manifest.get("source_state", "rehearsal"),
                  projectRef=getattr(args, "project_ref", None), snapshotSha256=manifest["snapshot_sha256"],
                  checkedAt=datetime.now(timezone.utc).isoformat(),
                  formulaPolicy="All source formulas/caches retained; complete imported review events define formal statistics")
    print(json.dumps(result))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

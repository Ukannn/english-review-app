"""Synthetic-only migration checks. No private snapshots are test fixtures."""
import argparse
import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "migration"))
from build_english_import import SQLBuffer, build_import, date_value, emit_copy, integer, stable_id, timestamp_value
import build_english_import
from db import connection_command, management_payload
from export_xlsx_snapshot import canonical_hash, export_snapshot, write_json, validate_freeze_metadata
from preflight_import import assess
from reconcile_derived_stats import compare_stats, expected_stats, expected_progress
from reconcile_english_import import compare_rows, read_raw_rows, read_target_ids
from snapshot import SCHEMA, load_snapshot
from staged_import import MAX_QUERY_BYTES, record_blocks, validate_staging

OWNER = "22222222-2222-4222-8222-222222222222"


class MigrationTest(unittest.TestCase):
    def setUp(self):
        artifact_dir = ROOT / "output" / "tests" / "migration"
        artifact_dir.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=artifact_dir)
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def workbook(self, *, reverse=False, extra=None):
        book = Workbook()
        readme = book.active
        readme.title = "README"
        readme.append(["Synthetic test", "Description"])
        readme.append([None, "=1+1"])
        source_rows = {
            "Config": [{"Key": "question_count_default", "Value": 25}],
            "Phrase Bank": [{"ID": "TEST-P-1", "Chunk": "make progress", "Review Stage": 2,
                             "Next Review": "2026-09-09", "Last Reviewed": "2026-09-08",
                             "Times Seen": 1, "Times Correct": 1}],
            "Daily Queue": [{"Queue ID": "TEST-Q-1", "Queue Date": "2026-09-08", "Position": 1,
                             "Phrase ID": "TEST-P-1", "Session ID": "TEST-S-1", "Planned Count": 1,
                             "Queue Status": "presented"}],
            "Session Questions": [{"Queue ID": "TEST-Q-1", "Queue Date": "2026-09-08", "Position": 1,
                                   "Phrase ID": "TEST-P-1", "Session ID": "TEST-S-1", "Question Status": "bound",
                                   "Question Type": "cloze", "Expected Answers JSON": '["make progress"]'}],
            "Review Log": [{"Date": "2026-09-08", "Tag": "TEST-P-1", "Result": "normal", "Affects SRS?": "yes"}],
            "Candidate Generation Inbox": [{"Request ID": "TEST-G-1", "Position": 1, "Candidate": "make a start"}],
        }
        if extra:
            source_rows.update(extra)
        for name, schema in SCHEMA.items():
            headers = list(reversed(schema)) if reverse else schema
            sheet = book.create_sheet(name)
            sheet.append(headers)
            for row in source_rows.get(name, []):
                sheet.append([row.get(header) for header in headers])
        path = self.base / f"source-{reverse}.xlsx"
        book.save(path)
        return path

    def snapshot(self, **kwargs):
        path = self.base / f"snapshot-{len(list(self.base.iterdir()))}"
        export_snapshot(self.workbook(**kwargs), path)
        return path

    def build(self, snapshot):
        return build_import(snapshot, self.base / f"import-{len(list(self.base.iterdir()))}", OWNER,
                            imported_at="2026-09-08T00:00:00Z")

    def mutate_sheet(self, snapshot, name, mutate):
        path = snapshot / "manifest.json"
        manifest = json.loads(path.read_text())
        summary = next(s for s in manifest["sheets"] if s["sheet"] == name)
        payload = json.loads((snapshot / summary["file"]).read_text())
        mutate(payload)
        for row in payload["rows"]:
            row["row_hash"] = canonical_hash({k: v for k, v in row.items() if k != "row_hash"})
        payload["row_count"] = len(payload["rows"])
        write_json(snapshot / summary["file"], payload)
        summary.update(headers=payload["headers"], row_count=payload["row_count"], content_sha256=canonical_hash(payload))
        manifest["snapshot_sha256"] = canonical_hash(manifest["sheets"])
        manifest["manifest_sha256"] = canonical_hash({k: v for k, v in manifest.items() if k != "manifest_sha256"})
        write_json(path, manifest)

    def test_formula_only_row_is_not_dropped(self):
        snapshot = self.snapshot()
        manifest, sheets, formulas = load_snapshot(snapshot)
        self.assertEqual(manifest["formula_count"], 1)
        self.assertEqual(len(sheets["README"]), 1)
        self.assertEqual(formulas[("README", 2)][0]["formula"], "=1+1")
        self.assertIsNone(formulas[("README", 2)][0]["calculated_value"])

    def test_dynamic_counts_and_previously_empty_adapter(self):
        report = self.build(self.snapshot())
        self.assertEqual(report["sourceRows"], 7)
        self.assertEqual(report["tableCounts"]["english_private.candidate_generation_rows"], 1)
        self.assertEqual(report["tableCounts"]["english_private.import_rows"], report["sourceRows"])
        self.assertEqual(set(report["sheetCounts"]), set(SCHEMA) | {"README"})
        self.assertEqual(report["targetAudit"]["orphanTargets"], 0)

    def test_reordered_headers_keep_business_mapping(self):
        first = self.build(self.snapshot())
        second = self.build(self.snapshot(reverse=True))
        self.assertEqual(first["tableCounts"], second["tableCounts"])
        for table in ("phrases", "candidates", "candidate_generation_rows"):
            self.assertEqual(first["targetIds"]["english_private."+table], second["targetIds"]["english_private."+table])

    def test_unknown_column_fails_before_output(self):
        snapshot = self.snapshot()
        self.mutate_sheet(snapshot, "Phrase Bank", lambda p: p["headers"].__setitem__(1, "Unknown Column"))
        with self.assertRaisesRegex(ValueError, "column"):
            self.build(snapshot)

    def test_unknown_sheet_fails(self):
        snapshot = self.snapshot()
        path = snapshot / "manifest.json"
        m = json.loads(path.read_text()); m["sheets"][0]["sheet"] = "Unexpected"
        m.pop("manifest_sha256")
        write_json(path, m)
        with self.assertRaisesRegex(ValueError, "source sheets"):
            self.build(snapshot)

    def test_hash_tamper_fails(self):
        snapshot = self.snapshot()
        manifest = json.loads((snapshot / "manifest.json").read_text())
        path = snapshot / manifest["sheets"][0]["file"]
        p = json.loads(path.read_text()); p["rows"][0]["values"][0] = "tampered"
        write_json(path, p)
        with self.assertRaisesRegex(ValueError, "hash"):
            self.build(snapshot)

    def test_duplicate_identity_and_orphan_fail(self):
        for rows in ([{"ID": "X", "Chunk": "a"}, {"ID": "X", "Chunk": "b"}],
                     [{"ID": "TEST-P-1", "Chunk": "a", "Source Candidate ID": "MISSING"}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.build(self.snapshot(extra={"Phrase Bank": rows}))

    def test_historical_unlogged_presentation_is_quarantined(self):
        report = self.build(self.snapshot())
        self.assertEqual(report["syntheticSessionCount"], 1)
        sql = next(self.base.glob("import-*/import.sql")).read_text()
        self.assertIn('"legacy_recovery"', sql)
        self.assertIn('"legacy"', sql)
        self.assertIn("IMPORT_ACTIVE_LEGACY_SESSION", sql)
        self.assertIn("IMPORT_ALREADY_EXISTS", sql)
        self.assertEqual(sql.count("\nbegin;\n"), 1)
        self.assertEqual(sql.count("\ncommit;\n"), 1)

    def test_actual_owner_required_and_namespaces_ids(self):
        snapshot = self.snapshot()
        with self.assertRaises(ValueError):
            build_import(snapshot, self.base/"out", "00000000-0000-0000-0000-000000000001")
        self.assertNotEqual(stable_id("phrase", "TEST", owner=OWNER),
                            stable_id("phrase", "TEST", owner="33333333-3333-4333-8333-333333333333"))

    def test_never_overwrites_existing_evidence(self):
        snapshot = self.snapshot()
        with self.assertRaises(ValueError):
            export_snapshot(self.workbook(), snapshot)
        output = self.base / "out"
        build_import(snapshot, output, OWNER)
        with self.assertRaises(ValueError):
            build_import(snapshot, output, OWNER)

    def test_source_freeze_is_explicit(self):
        report = self.build(self.snapshot())
        self.assertEqual(report["sourceState"], "rehearsal")
        with self.assertRaises(ValueError):
            export_snapshot(self.workbook(), self.base/"final", source_state="final_frozen")
        m = export_snapshot(self.workbook(), self.base/"final", source_state="final_frozen", frozen_at="2020-01-01T08:00:00+08:00")
        self.assertEqual(m["source_state"], "final_frozen")

    def test_final_freeze_requires_valid_timestamp_before_export(self):
        for freeze in ("not-a-date", "2020-01-01T00:00:00", "2021-01-01T00:00:00Z"):
            with self.assertRaises(ValueError):
                validate_freeze_metadata("final_frozen", freeze, "2020-01-02T00:00:00Z")
        validate_freeze_metadata("final_frozen", "2020-01-01T08:00:00+08:00", "2020-01-02T00:00:00Z")

    def test_import_guards_include_live_only_tables(self):
        self.build(self.snapshot())
        for path in (next(self.base.glob("import-*/import.sql")), next(self.base.glob("import-*/staged/999-promote.sql"))):
            sql = path.read_text()
            self.assertIn("IMPORT_TARGET_NOT_EMPTY: english_private.ai_jobs", sql)
            self.assertIn("IMPORT_TARGET_NOT_EMPTY: english_private.daily_observations", sql)
            self.assertIn("IMPORT_UNEXPECTED_AUTH_IDENTITY", sql)

    def test_readonly_preflight_distinguishes_empty_resume_and_promoted(self):
        manifest = {"ownerId": OWNER, "batchId": OWNER, "sourceSnapshotHash": "snapshot", "staged": {"planHash": "plan"}}
        payload = {"registeredOwner": OWNER, "authOwnerExists": True, "authUserCount": 1, "tableCounts": {"phrases": 0}, "batches": []}
        self.assertEqual(assess(manifest, payload)["state"], "ready")
        payload["batches"] = [{"id": OWNER, "ownerId": OWNER, "snapshotHash": "snapshot", "planHash": "plan", "status": "staged"}]
        self.assertEqual(assess(manifest, payload)["state"], "resumable")
        payload["batches"][0]["status"] = "promoted"
        self.assertEqual(assess(manifest, payload)["state"], "already_promoted_reconcile_required")
        payload["batches"] = []; payload["tableCounts"]["observations"] = 1
        self.assertEqual(assess(manifest, payload)["state"], "blocked")
        payload["tableCounts"]["observations"] = 0; payload["authUserCount"] = 2
        self.assertEqual(assess(manifest, payload)["state"], "blocked")

    def test_dates_and_invalid_date_are_not_guessed(self):
        self.assertEqual(date_value("2026-09-07T23:00:00Z"), "2026-09-08")
        self.assertEqual(timestamp_value("01:30:00", "2026-09-08"), "2026-09-07T17:30:00Z")
        self.assertEqual(timestamp_value("2026-09-08"), "2026-09-07T16:00:00Z")
        self.assertIsNone(timestamp_value("not captured"))
        with self.assertRaises(ValueError): timestamp_value("misspelled date")
        with self.assertRaises(ValueError): timestamp_value(0.5)
        with self.assertRaises(ValueError): integer(1.5)

    def test_literal_null_marker_and_json_string_preserved(self):
        buffer = SQLBuffer()
        emit_copy(buffer, "english_private.source_notes", ["id", "source", "context"], [("id", r"\N", None)])
        self.assertIn('"\\N",\\N', buffer.getvalue())
        buffer = SQLBuffer()
        emit_copy(buffer, "english_private.grade_result_attempts", ["id", "candidate_suggestions"], [("id", "invalid historical JSON")])
        self.assertIn('""invalid historical JSON""', buffer.getvalue())
        self.assertIn("jsonb_populate_recordset", buffer.copy_blocks[0][1])

    def test_reconciliation_detects_raw_formula_target_tampering(self):
        report = self.build(self.snapshot())
        row = report["rawRows"][0]
        actual = {"source_sheet": row["sourceSheet"], "source_row": row["sourceRow"], "row_hash": row["rowHash"],
                  "raw_json": {}, "formula_cells": [], "target_table": row["targetTable"], "target_id": row["targetId"]}
        result = compare_rows(report, [actual], report["targetIds"])
        self.assertFalse(result["ok"])
        self.assertGreater(result["missingRawRows"], 0)

    def test_raw_readback_uses_advancing_bounded_pages(self):
        cursor = "33333333-3333-4333-8333-333333333333"
        replies = [{"rows": [{"source_sheet": "README", "source_row": 2,
                               "raw_json_text": '{"value":15.0,"revision":1}',
                               "formula_cells_text": '[{"calculated_value":0.0}]'}],
                    "lastId": cursor, "payloadBytes": 125},
                   {"rows": [], "lastId": None, "payloadBytes": 0}]
        with patch("reconcile_english_import.run_sql", side_effect=[json.dumps(r) for r in replies]) as query:
            rows, stats = read_raw_rows(None, OWNER, OWNER)
        self.assertEqual(len(rows), 1)
        self.assertIsInstance(rows[0]["raw_json"]["value"], float)
        self.assertIsInstance(rows[0]["raw_json"]["revision"], int)
        self.assertIsInstance(rows[0]["formula_cells"][0]["calculated_value"], float)
        self.assertEqual(canonical_hash(rows[0]["raw_json"]), canonical_hash({"value": 15.0, "revision": 1}))
        self.assertIn("raw_json::text", query.call_args_list[0].args[1])
        self.assertIn("formula_cells::text", query.call_args_list[0].args[1])
        self.assertEqual(stats, {"rawReadbackPages": 1, "largestRawPageBytes": 125})
        self.assertIn("running_bytes <=", query.call_args_list[0].args[1])
        self.assertIn(f"id > '{cursor}'", query.call_args_list[1].args[1])
        with patch("reconcile_english_import.run_sql", return_value=json.dumps(replies[0])):
            with self.assertRaisesRegex(ValueError, "cursor did not advance"):
                read_raw_rows(None, OWNER, OWNER)

    def test_identity_readback_rejects_duplicate_ids_and_unsafe_table(self):
        with patch("reconcile_english_import.run_sql", return_value=json.dumps([OWNER, OWNER])):
            with self.assertRaisesRegex(ValueError, "cursor did not advance"):
                read_target_ids(None, OWNER, ["english_private.phrases"])
        with self.assertRaisesRegex(ValueError, "Unknown manifest target table"):
            read_target_ids(None, OWNER, ["english_private.phrases; select 1"])

    def test_derived_stats_use_all_events_and_detect_extras(self):
        _, sheets, _ = load_snapshot(self.snapshot())
        expected = expected_stats(sheets)
        self.assertEqual(expected["TEST-P-1"]["timesSeen"], 1)
        self.assertTrue(compare_stats(expected, list(expected.values()))["ok"])
        self.assertFalse(compare_stats(expected, list(expected.values())+[{"id": "EXTRA"}])["ok"])

    def test_historical_progress_checks_stage_due_and_status(self):
        _, sheets, _ = load_snapshot(self.snapshot())
        expected = expected_progress(sheets)
        self.assertTrue(compare_stats(expected, list(expected.values()))["ok"])
        for field, value in (("reviewStage", 3), ("nextReviewEpoch", 0), ("status", "paused")):
            actual = copy.deepcopy(list(expected.values()))
            actual[0][field] = value
            self.assertFalse(compare_stats(expected, actual)["ok"])

    def test_database_url_not_in_process_arguments(self):
        args = argparse.Namespace(database_url_env="TEST_IMPORT_URL", pg_service=None, docker_container=None,
                                  docker_database="postgres", psql_bin="psql")
        with patch.dict(os.environ, {"TEST_IMPORT_URL": "postgres://example:secret@localhost/test"}):
            command, env = connection_command(args)
        self.assertNotIn("secret", " ".join(command))
        self.assertIn("secret", env["PGDATABASE"])

    def test_management_api_envelope_is_strict(self):
        self.assertEqual(json.loads(management_payload('{"rows":[{"payload":{"ok":true}}],"warning":"data only"}')), {"ok": True})
        self.assertEqual(management_payload('{"rows":[]}'), "")
        for value in ('[]', '{"data":[]}', '{"rows":[{"a":1,"b":2}]}'):
            with self.assertRaises(ValueError): management_payload(value)

    def test_api_sql_has_no_psql_copy_stream(self):
        self.build(self.snapshot())
        sql = next(self.base.glob("import-*/import-api.sql")).read_text()
        self.assertNotIn(" from stdin ", sql)
        self.assertNotIn("\\set ON_ERROR_STOP", sql)
        self.assertIn("jsonb_populate_recordset", sql)
        self.assertTrue(sql.startswith("do $import_"))
        self.assertNotIn("\ncommit;", sql)

    def test_staged_requests_are_bounded_and_promotion_contains_no_source_answers(self):
        report = self.build(self.snapshot())
        self.assertLessEqual(report["staged"]["maxQueryBytes"], MAX_QUERY_BYTES)
        final = next(self.base.glob("import-*/staged/999-promote.sql")).read_text()
        self.assertIn("STAGING_BLOCK_HASH_MISMATCH", final)
        self.assertIn("IMPORT_ACTIVE_LEGACY_SESSION", final)
        self.assertNotIn("make progress", final)
        self.assertNotIn(" from stdin ", final)

    def test_block_packing_splits_by_size_and_count(self):
        records = [{"id": str(i), "answer": "x" * 5000} for i in range(300)]
        blocks = list(record_blocks("test", records))
        self.assertGreater(len(blocks), 1)
        self.assertEqual(sum(count for _, count in blocks), 300)
        self.assertTrue(all(len(payload.encode()) < MAX_QUERY_BYTES and count <= 200 for payload, count in blocks))

    def test_staging_resume_requires_exact_hash_and_table(self):
        manifest = {"staged": {"planHash": "plan", "blocks": [{"index": 0, "sha256": "abc", "table": "table"}]}}
        state = {"batch": {"planHash": "plan", "status": "staged"},
                 "blocks": [{"index": 0, "sha256": "abc", "verifiedHash": "abc", "table": "table"}]}
        self.assertEqual(len(validate_staging(manifest, state)), 1)
        for field in ("verifiedHash", "sha256", "table"):
            wrong = copy.deepcopy(state); wrong["blocks"][0][field] = "wrong"
            with self.assertRaises(ValueError): validate_staging(manifest, wrong)

    def test_staging_plan_binds_promotion_column_conversions(self):
        snapshot = self.snapshot()
        original = self.build(snapshot)
        convert = build_english_import.select_columns
        with patch.object(build_english_import, "select_columns",
                          side_effect=lambda table, columns: convert(table, columns) + " /* changed converter */"):
            changed = self.build(snapshot)
        self.assertEqual([b["sha256"] for b in original["staged"]["blocks"]],
                         [b["sha256"] for b in changed["staged"]["blocks"]])
        self.assertNotEqual(original["staged"]["planHash"], changed["staged"]["planHash"])

    def test_staged_settings_preserve_json_null(self):
        self.build(self.snapshot())
        final = next(self.base.glob("import-*/staged/999-promote.sql")).read_text()
        self.assertIn("coalesce(value,'null'::jsonb)", final)

    def test_blank_config_json_value_is_not_sql_null(self):
        buffer = SQLBuffer()
        emit_copy(buffer, "english_private.settings", ["id", "value"], [("id", "null")])
        self.assertIn('"null"', buffer.getvalue())
        self.assertIn("coalesce(value,'null'::jsonb)", buffer.copy_blocks[0][1])


if __name__ == "__main__":
    unittest.main()

"""Validate snapshot integrity and map column names independently of column order."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from export_xlsx_snapshot import canonical_hash, validate_freeze_metadata

SCHEMA = json.loads(Path(__file__).with_name("sheet_schema.json").read_text(encoding="utf-8"))


def load_snapshot(snapshot: Path):
    snapshot = snapshot.resolve()
    manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
    version = manifest.get("format_version", 1)
    if version not in (1, 2):
        raise ValueError("Unsupported snapshot format_version")
    if "manifest_sha256" in manifest and canonical_hash({k: v for k, v in manifest.items() if k != "manifest_sha256"}) != manifest["manifest_sha256"]:
        raise ValueError("Manifest metadata hash mismatch")
    if manifest.get("source_state", "rehearsal") not in ("rehearsal", "final_frozen"):
        raise ValueError("Unsupported source state")
    if manifest.get("source_state") == "final_frozen" and (not manifest.get("manifest_sha256") or not manifest.get("source_frozen_at")):
        raise ValueError("Final snapshot lacks freeze evidence metadata")
    validate_freeze_metadata(manifest.get("source_state", "rehearsal"), manifest.get("source_frozen_at"), manifest.get("exported_at"))
    if manifest.get("timezone", "Asia/Shanghai") != "Asia/Shanghai":
        raise ValueError("Unsupported source timezone")
    if manifest.get("excel_epoch", "1899-12-30T00:00:00") != "1899-12-30T00:00:00":
        raise ValueError("Unsupported Excel epoch; explicit adapter required")
    summaries = manifest["sheets"]
    names = [s["sheet"] for s in summaries]
    if len(names) != len(set(names)) or set(names) != set(SCHEMA) | {"README"}:
        raise ValueError(f"Unknown or missing source sheets: expected registered adapters; got {names}")
    if len(names) != manifest["sheet_count"] or canonical_hash(summaries) != manifest["snapshot_sha256"]:
        raise ValueError("Snapshot manifest hash/count mismatch")
    sheets, formulas = {}, defaultdict(list)
    total_formulas = 0
    for summary in summaries:
        name = summary["sheet"]
        path = (snapshot / summary["file"]).resolve()
        if not path.is_relative_to(snapshot):
            raise ValueError("Sheet path escapes snapshot")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if canonical_hash(payload) != summary["content_sha256"]:
            raise ValueError(f"{name}: sheet hash mismatch")
        headers = payload["headers"]
        if payload["sheet"] != name or headers != summary["headers"]:
            raise ValueError(f"{name}: sheet identity/header mismatch")
        if name != "README" and (len(headers) != len(set(headers)) or set(headers) != set(SCHEMA[name])):
            raise ValueError(f"{name}: unknown/missing/duplicate column; adapter must be reviewed")
        rows = payload["rows"]
        if len(rows) != payload["row_count"] or len(rows) != summary["row_count"]:
            raise ValueError(f"{name}: row count mismatch")
        if len(payload["formulas"]) != payload["formula_count"] or payload["formula_count"] != summary["formula_count"]:
            raise ValueError(f"{name}: formula count mismatch")
        row_numbers = set()
        for row in rows:
            number = row["source_row"]
            if not isinstance(number, int) or number < 2 or number in row_numbers or row["source_sheet"] != name:
                raise ValueError(f"{name}: invalid/duplicate row coordinate")
            row_numbers.add(number)
            if len(row["values"]) != len(headers) or canonical_hash({k: v for k, v in row.items() if k != "row_hash"}) != row["row_hash"]:
                raise ValueError(f"{name} row {number}: row width/hash mismatch")
        for formula in payload["formulas"]:
            if formula["source_row"] not in row_numbers:
                raise ValueError(f"{name}: orphan formula row")
            formulas[(name, formula["source_row"])].append(formula)
        mapped = []
        for row in rows:
            if version == 2 and row["formula_cells"] != formulas[(name, row["source_row"])]:
                raise ValueError(f"{name}: formula ledger mismatch")
            # README is free-form content, so retain coordinates rather than treating content as schema.
            record = ({f"column_{i+1}": value for i, value in enumerate(row["values"])} if name == "README"
                      else dict(zip(headers, row["values"])))
            record.update(__source_row=row["source_row"], __row_hash=row["row_hash"],
                          __headers=headers, __values=row["values"])
            mapped.append(record)
        sheets[name] = mapped
        total_formulas += payload["formula_count"]
    if total_formulas != manifest["formula_count"]:
        raise ValueError("Manifest formula total mismatch")
    return manifest, sheets, formulas

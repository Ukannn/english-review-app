#!/usr/bin/env python3
"""Run a generated import only with --apply, then read it back against its manifest."""
import argparse
import hashlib
import json
from pathlib import Path

from db import add_connection_arguments, run_sql
from reconcile_english_import import reconcile
from staged_import import apply_staged, checked_sql


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("import_directory", type=Path)
    parser.add_argument("--apply", action="store_true", help="Required to write; without it only validates local SQL integrity")
    parser.add_argument("--allow-rehearsal", action="store_true", help="Allow unfrozen data in an explicitly selected local Docker database only")
    parser.add_argument("--staged", action="store_true", help="Exercise the resumable path locally; always used for --project-ref")
    parser.add_argument("--stage-only", action="store_true", help="Store verified payloads without writing business tables")
    parser.add_argument("--max-blocks", type=int, help="Limit newly staged blocks for an intentional interruption drill")
    add_connection_arguments(parser)
    args = parser.parse_args()
    manifest = json.loads((args.import_directory / "import-manifest.json").read_text())
    api_mode = bool(args.project_ref)
    sql = (args.import_directory / ("import-api.sql" if api_mode else "import.sql")).read_text()
    if hashlib.sha256(sql.encode()).hexdigest() != manifest["apiSqlSha256" if api_mode else "sqlSha256"]:
        raise ValueError("Generated SQL has changed; rebuild and review before applying")
    if args.project_ref or args.staged:
        files = manifest["staged"]
        for entry in [files["setup"], *files["blocks"], files["promote"]]:
            checked_sql(args.import_directory / "staged", entry)
    if args.max_blocks is not None and args.max_blocks < 1:
        raise ValueError("--max-blocks must be positive")
    if not args.apply:
        print(json.dumps({"ok": True, "mode": "local_validation_only", "batchId": manifest["batchId"]}))
        return
    if manifest.get("sourceState") != "final_frozen" and not (args.allow_rehearsal and args.docker_container):
        raise ValueError("Unfrozen snapshot: only local Docker rehearsal is allowed")
    staging = None
    if args.project_ref or args.staged:
        staging = apply_staged(args, args.import_directory / "staged", manifest,
                               stage_only=args.stage_only, max_blocks=args.max_blocks)
        if staging["state"] != "promoted":
            print(json.dumps({"ok": False, "mode": "staged_only", **staging, "batchId": manifest["batchId"]}))
            return
    elif args.stage_only or args.max_blocks is not None:
        raise ValueError("--stage-only/--max-blocks requires --staged or --project-ref")
    else:
        run_sql(args, sql, expect_result=False)
    result = reconcile(args, manifest)
    if staging:
        result["staging"] = staging
    (args.import_directory / "reconciliation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

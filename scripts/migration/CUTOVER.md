# Final import and Pages handoff

These commands are prepared operations, not evidence that the cloud cutover ran.
Use the final workbook exported **after** all legacy writers were frozen. A
`final_frozen` label is an operator assertion; the scripts cannot prove that
Google Apps Script or external scheduled tasks stopped.

The new Auth user must exist and its UUID must be the single
`english_private.app_owner.owner_id`. Auth recovery/login state is allowed.
Learning/business tables must still be empty, and the queue cron must be disabled.
In particular, `get_review_bootstrap` creates a queue and daily observation even
when no phrases exist. A Preview login that opened the learning homepage therefore
requires inspection before import. The importer refuses existing rows; it does not
erase Preview activity or merge it into history.

Set these variables to values independently verified for the new English project:

```sh
ENGLISH_PYTHON=python3
ENGLISH_PROJECT_REF='<new English project ref>'
ENGLISH_OWNER_ID='<registered Auth owner UUID>'
ENGLISH_FREEZE_AT='<actual freeze time, e.g. 2026-09-08T12:30:00+08:00>'
ENGLISH_FINAL_XLSX='<absolute path of the new post-freeze workbook export>'
ENGLISH_CUTOVER_DIR=output/cutover/final-20260908
mkdir -p "$ENGLISH_CUTOVER_DIR"
```

1. Export and validate the final snapshot, then generate a fresh owner-specific
   bundle. Do not reuse the rehearsal manifest or manually change its source state.

```sh
"$ENGLISH_PYTHON" scripts/migration/export_xlsx_snapshot.py "$ENGLISH_FINAL_XLSX" "$ENGLISH_CUTOVER_DIR/snapshot" --source-state final_frozen --frozen-at "$ENGLISH_FREEZE_AT" > "$ENGLISH_CUTOVER_DIR/snapshot-summary.json"
"$ENGLISH_PYTHON" scripts/migration/build_english_import.py "$ENGLISH_CUTOVER_DIR/snapshot" "$ENGLISH_CUTOVER_DIR/import" --owner-id "$ENGLISH_OWNER_ID" > "$ENGLISH_CUTOVER_DIR/build-summary.json"
```

The source manifest contains `source_state=final_frozen`, a timezone-aware
`source_frozen_at` no later than `exported_at`, workbook SHA-256, per-sheet and row
hashes, formula/cache ledgers, snapshot SHA-256 and metadata hash. The builder
validates them and propagates `sourceState`, `sourceFrozenAt`, `ownerId`, `batchId`
and `sourceSnapshotHash` to the import manifest. Counts are read from this export.

2. Read the target and validate the local bundle before any staging write.

```sh
"$ENGLISH_PYTHON" scripts/migration/preflight_import.py "$ENGLISH_CUTOVER_DIR/import/import-manifest.json" --project-ref "$ENGLISH_PROJECT_REF" > "$ENGLISH_CUTOVER_DIR/preflight.json"
"$ENGLISH_PYTHON" scripts/migration/run_import.py "$ENGLISH_CUTOVER_DIR/import" --project-ref "$ENGLISH_PROJECT_REF"
```

`preflight.json` must report `ready` or `resumable`. The second command has no
`--apply`; it validates generated SQL hashes only. `blocked` needs inspection,
never an automatic delete. `already_promoted_reconcile_required` means to run
reconciliation against the existing result rather than start another import.

3. Apply the bounded staged bundle and read it back. Keep the app and queue cron
   from creating new learning rows until both checks finish.

```sh
"$ENGLISH_PYTHON" scripts/migration/run_import.py "$ENGLISH_CUTOVER_DIR/import" --apply --project-ref "$ENGLISH_PROJECT_REF" > "$ENGLISH_CUTOVER_DIR/import-result.json"
"$ENGLISH_PYTHON" scripts/migration/reconcile_derived_stats.py "$ENGLISH_CUTOVER_DIR/snapshot" --owner-id "$ENGLISH_OWNER_ID" --project-ref "$ENGLISH_PROJECT_REF" > "$ENGLISH_CUTOVER_DIR/derived-reconciliation.json"
```

The runner writes `import/reconciliation.json` only after promotion and readback.
The raw/formula/ID result and derived/history-progress result must both have
`ok=true`. Their `projectRef` must be this English project and `snapshotSha256`
must match the final manifest. This is still before the first new learning write.

After an interrupted request, use the **same directory, owner and project**. The
runner reads stored hashes, skips only verified blocks and checks whether promotion
already committed. Do not regenerate timestamps/IDs, overwrite SQL, or create a
second batch to work around an uncertain response.

If promotion succeeded but reconciliation failed, inspect the readback before
changing data. Recheck without any write:

```sh
"$ENGLISH_PYTHON" scripts/migration/reconcile_english_import.py "$ENGLISH_CUTOVER_DIR/import/import-manifest.json" --project-ref "$ENGLISH_PROJECT_REF"
```

Raw JSON and formula JSON
travel as database text during this check: the Management API/CLI otherwise
normalizes numbers such as `15.0` to `15`, causing false snapshot-hash mismatches.
The strict source hashes remain unchanged; no numeric coercion or mismatch
allowlist is used to pass the gate.

4. Pass the actual remote final reconciliation to the release script. The English
   publishable key must already be present in `VITE_SUPABASE_PUBLISHABLE_KEY`.

```sh
node scripts/operations/release-pages.mjs --environment production --project-ref "$ENGLISH_PROJECT_REF" --reconciliation "$ENGLISH_CUTOVER_DIR/import/reconciliation.json"
```

The release gate expects `ok=true`, `ownerRegistered=true`, `activeLegacyCount=0`,
`rawMismatchCount=0`, `missingRawRows=0`, the same `projectRef`,
`sourceState=final_frozen`, `snapshotSha256` and `checkedAt`. No rehearsal result
qualifies. Read back the deployed `build-info.json`, then enable the approved cron
and verify login and the learning flow. Once the first new learning event exists,
rollback must preserve and reconcile that increment first.

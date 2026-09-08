# English history migration

Python 3.11+ and `pip install -r scripts/migration/requirements.txt` are required.
All workbooks, snapshots, generated SQL, manifests and logs belong under ignored `output/`.
The scripts never modify the source workbook or connect to Google Sheets.
The prepared final export/import/release commands are in [CUTOVER.md](CUTOVER.md).

```sh
python3 -m unittest discover -s tests/migration -p 'test_*.py'
python3 scripts/migration/export_xlsx_snapshot.py output/source.xlsx output/snapshot
python3 scripts/migration/build_english_import.py output/snapshot output/import --owner-id ACTUAL_AUTH_UUID
```

The default snapshot is marked `rehearsal`. For the cutover, first stop every legacy
writer, export the final workbook, then use
`--source-state final_frozen --frozen-at TIME_WITH_TIMEZONE` on the exporter. This is
an operator assertion of an externally completed freeze, not automatic proof that
Google triggers or scheduled tasks stopped. The final snapshot and import manifest
retain the assertion and its timestamp.

The builder validates the manifest, every sheet/row hash and formula ledger before
creating output. Column order can change; known column names must remain intact.
Unknown sheets, extra/missing columns, ambiguous duplicate IDs and unexplained
references stop the build. `README` is preserved as free-form cells. Historical
version-1 snapshots remain readable. Row/formula counts always come from the input.

The actual Auth user must already exist and be registered in `english_private.app_owner`.
`preflight_import.py` reads owner identity and all history/live table counts, and
distinguishes a new target, a matching interrupted import and an already promoted
batch. It never deletes or writes. Extra Auth identities or Preview learning rows
must be inspected; import protection covers live-only AI/observation/activity tables too.
Old rehearsal owner IDs are rejected. Generated UUIDs include the supplied owner.
Each original row retains its source coordinates, headers, cached values, formulas,
legacy ID and target ID. Rejected question/grading attempts are preserved. A legacy
presentation lacking a Session Log row gets a documented historical session with
no invented start/completion time. Missing optional timestamps can use import time
only for database `created_at` metadata; invalid date strings fail instead of being
silently replaced. The known literal `not captured` remains in raw history and maps
to SQL NULL. All old queues/sessions are historical; drafts never automatically resume.

`import.sql` is a native psql COPY transaction. `import-api.sql` is the equivalent
single atomic DO statement, retained for comparison and local verification; its
size can exceed remote request limits. Production uses the generated `staged/`
bundle: payloads are at most 240 KiB and every SQL request is at most 512 KiB.
Staging writes only the import batch and payload tables. One final DO statement
verifies every block, imports all business/history rows and checks counts and mapped
targets in a single transaction. A failed promotion leaves business tables unchanged.

The runner reads the stored plan and payload hashes before resuming. The plan hash
binds the source, owner, table mappings and promotion code. It skips only exact,
verified blocks; conflicting imports are refused. After an uncertain request it
reads back the result before deciding whether that step committed. Repeating a
completed bundle performs reconciliation without rewriting history. Native COPY
imports still refuse any previous import. Existing output directories are never
overwritten; regenerate a changed plan in a new directory and review the conflict
rather than overwriting partially staged evidence.

Supported connection modes are explicit and mutually exclusive:

```sh
# Local rehearsal in an isolated database in the local Supabase container.
python3 scripts/migration/run_import.py output/import --apply --allow-rehearsal --docker-container CONTAINER --docker-database ISOLATED_DB

# Exercise the same staged path locally: interrupt after three blocks, then resume.
python3 scripts/migration/run_import.py output/import --apply --allow-rehearsal --staged --stage-only --max-blocks 3 --docker-container CONTAINER --docker-database ISOLATED_DB
python3 scripts/migration/run_import.py output/import --apply --allow-rehearsal --staged --docker-container CONTAINER --docker-database ISOLATED_DB

# Final cutover through the already-authenticated Supabase CLI; no DB password needed.
python3 scripts/migration/run_import.py output/import --apply --project-ref ENGLISH_PROJECT_REF

# Alternatively, supply a libpq service or an environment variable NAME containing a URL.
python3 scripts/migration/run_import.py output/import --apply --database-url-env ENGLISH_DATABASE_URL

python3 scripts/migration/reconcile_english_import.py output/import/import-manifest.json --project-ref ENGLISH_PROJECT_REF
python3 scripts/migration/reconcile_derived_stats.py output/snapshot --owner-id ACTUAL_AUTH_UUID --project-ref ENGLISH_PROJECT_REF
```

Without `--apply`, the runner validates local SQL integrity only, including every
staged file when that mode is selected. Credentials are
never printed or put in subprocess arguments for the libpq path. The Management
API adapter uses a private temporary SQL file and explicitly selects the project.
CLI JSON-envelope parsing was verified locally with version 2.116. The runner
never blindly retries a rejected or uncertain remote call.

`reconcile_english_import.py` checks every raw value/formula fingerprint and all
promoted target IDs against the generated manifest. Readback uses size-bounded,
keyset-paginated raw rows and bounded identity pages so it does not require a
single large Management API response. Reconciliation records source state, explicit
project ref (null locally), snapshot hash and check time. The SQL companion provides a
dynamic count summary using `owner_id` and `batch_id` psql variables. Reconciliation
expects a frozen cutover database, before new learning writes. Derived-stat checks
use all imported review events and also compare every phrase's historical stage,
due timestamp, status, mastery streak and last result. They separately report
cached-formula drift. A formula
cache mismatch does not authorize changing historical events or throwing away formulas.

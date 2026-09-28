# English Learning Lab architecture

English Learning Lab is an independent single-owner React PWA on Cloudflare Pages with Supabase Auth and Postgres. This repository owns the frontend, database migrations, history import and release tools. Korean has a separate project and is never a deployment target. The retained [legacy architecture](legacy-architecture.md) describes the pre-cutover Sheets system.

## Trust and data boundaries

Business records reside in `english_private`. The browser holds only a publishable key and calls `english_api` RPCs. An administrator registers the sole Auth owner explicitly; first login cannot claim ownership. Private tables have RLS and no direct authenticated DML grants. RPCs check the authenticated owner, expected revision, immutable batch identity and idempotency key as applicable.

The client fails clearly when production configuration is missing. Demo mode is explicit. English has its own Auth storage, service worker and IndexedDB recovery. Logout removes local study data. No administrator database-password management is exposed in the app.

## Learning workflow

Context intake → proposed candidates → user confirmation → daily queue → prepared questions → answer and reveal → frozen submission → AI grade proposal → user correction and confirmation → review events and schedule → analytics.

The four AI jobs are `context_extract`, `candidate_generate`, `question_prepare` and `grade_submission`. The app prepares a frozen job. The user sends one short command to ChatGPT connected to Supabase; ChatGPT reads the pending jobs and complete typed contract, generates the output, calls the existing import RPC and reads back completion. The app checks every ten seconds and on window focus, then refreshes the relevant learning view. There is no manual JSON entry. Server validation binds the output to the job and snapshot. Invalid, stale or mismatched JSON cannot silently update learning history.

## Daily planning and practice

Versioned `english_v3` packages contain up to eight independent review tasks (future preference 4–12), a 120–180 word reading and exactly two expression tasks. Both active and mastered due items are eligible; at most one confirmed new expression is added. Material is a separate object, not a question. `lessons` freezes material, sequence, theme and target associations; `lesson_exposures` records actual exposure. The original v2 setting remains historical and in-flight v2 sessions/jobs use retained implementations. See [learning policy](learning-policy.md).

Daily planning is idempotent, with a 04:00 Asia/Shanghai database schedule and an app-open fallback. Cron is installed inactive until formal cutover. Queue construction never calls a paid AI service or sends messages to ChatGPT.

The learning unit is a meaning-specific chunk or construction with a clear context and usage boundary. Practice type depends on retrieval evidence independently of review interval. New material first receives a brief meaning, example and usage note; it is hidden before retrieval. Cloze, complete chunk recall and purposeful short responses add support or contextual variation gradually. Hints are optional and recorded. Different-date, different-prompt unaided successes inform practice difficulty; immediate same-day success is not cross-day mastery evidence.

## Answers, grading and history

Reveal persists the answer locally immediately. V3 saves unsent text locally and checkpoints each revealed answer. V2 retains its five-answer checkpoints. Stage activity is persisted by RPC, and completed checkpoints resume across devices. Revision conflicts preserve local work and present an explicit resolution. The server freezes question, observed answer, hints and rubric in the submitted snapshot.

Grading distinguishes target retrieval, communicated meaning, naturalness and hint use. A reasonable alternative can communicate successfully while leaving the target unmeasured. Non-target errors do not erase correct target retrieval. User corrections are preserved in the final confirmation record.

New-rule review intervals are `1, 2, 4, 7, 14, 30, 60, 120` days. Unaided full retrieval before exposure advances one stage; local gap success holds the stage and returns within three days; hinted success preserves stage and returns within three days; substantive partial errors lower one stage and return within three days; failure resets to the first stage for tomorrow. An unmeasured target preserves stage and receives an explicit recall task tomorrow. An item can advance only once per Shanghai date; same-day retries are separate practice events. Initial learning is due tomorrow.

Counts, time budget, stage thresholds and intervals are product defaults, not claims of a proven optimal SLA algorithm. The evidence and limitations are documented in [learning policy](learning-policy.md).

Legacy scores and due dates remain historical facts. Import retains original IDs, all source rows, hashes, formulas and cached values. Old drafts and failed grading remain recovery/audit records, not active new-rule sessions. New statistics are calculated from committed events and shown separately from legacy metrics.

## Cutover and recovery

The local English stack can rebuild from an empty database without Korean migrations. Migration tools validate a fresh manifest and live headers, use the real new owner, stage all rows and reconcile references and hashes before promotion. A successful rehearsal is not a production import.

The replacement must pass Preview before old English writers are stopped. Then capture the final frozen snapshot, import transactionally, reconcile, publish Production and activate queue cron. Before the first new formal write, rollback may reopen the old system. Afterward, preserve and reconcile new events before repair or rollback to prevent dual writes.

Local database backups, their tools, restore drills and scheduling workflows were removed at the owner's request on 2026-09-20. Migration reconciliation receipts remain cutover evidence. Browser recovery drafts remain part of answer synchronization, not a database backup.


## Frontend hierarchy and identity

`AppShell` owns the desktop sidebar, mobile header and five-item bottom navigation. Hash routes are `today`, `intake`, `analytics`, `library` and `status`. Today owns review and grading; its active question remains mounted during navigation so unrevealed local text survives a visit to another page. A new queue resets that workspace. Library owns expression details and candidate confirmation; Settings owns count preferences and material generation. Analytics uses existing English evidence and leaves unattempted dates empty.

The visual language follows the Korean app: warm paper surfaces, serif display headings, navy/red/ochre accents, rounded cards and system dark mode. English branding uses the generated E/book master at `pwa/public/logo.png`; `logo-128.png` appears in the sidebar, mobile header and authentication screen. The 32 px favicon, 180 px Apple touch icon and 192/512 px manifest icons derive from that same master. PNG files are precached with the PWA shell.

## V3 deployment and rollback boundary

Apply the additive migration before deploying compatible frontend code. Existing owners receive disabled v3 generation; enable `v3_learning_settings.enabled` after the frontend is verified. Turning it off stops new v3 generation while existing prepared jobs and sessions remain resumable. Do not revert schema or delete learning evidence. Existing scores and due dates are unchanged by the migration. Docker is supported for isolated tests only; there is no database backup pipeline.

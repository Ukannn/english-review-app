# English Learning Lab architecture

English Learning Lab is an independent single-owner React PWA on Cloudflare Pages with Supabase Auth and Postgres. This repository owns the frontend, database migrations, history import and release tools. Korean has a separate project and is never a deployment target. The retained [legacy architecture](legacy-architecture.md) describes the pre-cutover Sheets system.

## Trust and data boundaries

Business records reside in `english_private`. The browser holds only a publishable key and calls `english_api` RPCs. An administrator registers the sole Auth owner explicitly; first login cannot claim ownership. Private tables have RLS and no direct authenticated DML grants. RPCs check the authenticated owner, expected revision, immutable batch identity and idempotency key as applicable.

The client fails clearly when production configuration is missing. Demo mode is explicit. English has its own Auth storage, service worker and IndexedDB recovery. Logout removes local study data. No administrator database-password management is exposed in the app.

## Learning workflow

Context intake → proposed candidates → user confirmation → daily queue → prepared questions → answer and reveal → frozen submission → AI grade proposal → user correction and confirmation → review events and schedule → analytics.

The four AI jobs are `context_extract`, `candidate_generate`, `question_prepare` and `grade_submission`. The app prepares a frozen job. The user sends one short command to ChatGPT connected to Supabase; ChatGPT reads the pending jobs and complete typed contract, generates the output, calls the existing import RPC and reads back completion. The app checks every ten seconds and on window focus, then refreshes the relevant learning view. There is no manual JSON entry. Server validation binds the output to the job and snapshot. Invalid, stale or mismatched JSON cannot silently update learning history.

## Daily planning and practice

The default target is 12, configurable from 1–150 for today, future default, or both. Reductions protect answered, revealed and frozen positions. Increases select eligible material; insufficient material is reported instead of filling with non-due phrases. Due phrases precede at most two new candidates per day. At most three short-response questions count toward the formal target.

Daily planning is idempotent, with a 04:00 Asia/Shanghai database schedule and an app-open fallback. Cron is installed inactive until formal cutover. Queue construction never calls a paid AI service or sends messages to ChatGPT.

The learning unit is a meaning-specific chunk or construction with a clear context and usage boundary. Practice type depends on retrieval evidence independently of review interval. New material first receives a brief meaning, example and usage note; it is hidden before retrieval. Cloze, complete chunk recall and purposeful short responses add support or contextual variation gradually. Hints are optional and recorded. Different-date, different-prompt unaided successes inform practice difficulty; immediate same-day success is not cross-day mastery evidence.

## Answers, grading and history

Reveal persists the answer locally immediately. Every five revealed answers form a serialized checkpoint; final submission atomically includes the tail. Revision conflicts preserve local work and present an explicit resolution. The server freezes question, observed answer, hints and rubric in the submitted snapshot.

Grading distinguishes target retrieval, communicated meaning, naturalness and hint use. A reasonable alternative can communicate successfully while leaving the target unmeasured. Non-target errors do not erase correct target retrieval. User corrections are preserved in the final confirmation record.

New-rule review intervals are `1, 2, 4, 7, 14, 30, 60, 120` days. Unaided correct retrieval advances one stage; hinted success preserves stage and returns within three days; substantive partial errors lower one stage and return within three days; failure resets to the first stage for tomorrow. An unmeasured target preserves stage and receives an explicit recall task tomorrow. An item can advance only once per Shanghai date; same-day retries are separate practice events. Initial learning is due tomorrow.

Counts, time budget, stage thresholds and intervals are product defaults, not claims of a proven optimal SLA algorithm. The evidence and limitations are documented in [learning policy](learning-policy.md).

Legacy scores and due dates remain historical facts. Import retains original IDs, all source rows, hashes, formulas and cached values. Old drafts and failed grading remain recovery/audit records, not active new-rule sessions. New statistics are calculated from committed events and shown separately from legacy metrics.

## Cutover and recovery

The local English stack can rebuild from an empty database without Korean migrations. Migration tools validate a fresh manifest and live headers, use the real new owner, stage all rows and reconcile references and hashes before promotion. A successful rehearsal is not a production import.

The replacement must pass Preview before old English writers are stopped. Then capture the final frozen snapshot, import transactionally, reconcile, publish Production and activate queue cron. Before the first new formal write, rollback may reopen the old system. Afterward, preserve and reconcile new events before repair or rollback to prevent dual writes.

Local English backups and weekly backup automation are disabled by the owner's 2026-09-08 update. Temporary migration snapshots and reconciliation evidence remain necessary for cutover. The optional encryption utility and completed restore drill are retained as development artifacts; neither is a production release requirement.

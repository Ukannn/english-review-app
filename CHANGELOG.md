# Changelog

## v0.12.1 — 2026-09-08

- Match the Korean short-command AI workflow for English: connected ChatGPT reads, generates, saves and verifies tasks; the app refreshes on completion.
- Remove manual JSON and full-prompt handoff controls from the PWA.

Project semantic versions and Google Apps Script immutable versions are separate identifiers.

## v0.12.0 — Independent English Learning Lab

- Introduce an independent React PWA, Supabase private schema/API, owner authentication and Cloudflare Pages release chain.
- Add material intake, candidate confirmation, manual ChatGPT JSON handoff, adaptive practice, hints, checkpoint recovery and separate target/expression feedback.
- Support daily question counts from 1 to 150, three setting scopes, password recovery/change and 14-day learning analysis.
- Add transparent English-specific scheduling, a daily queue, immutable submitted evidence and same-day progression protection.
- Migrate legacy workbook history using bounded, resumable staging, atomic promotion and strict raw/formula/ID/progress reconciliation; preserve JSON numeric representations during cloud readback.
- Retire the legacy write entry points with a generated read-only Apps Script release (version 35); retain version-33 source as the historical build baseline.
- Require a clean working tree at the merged private GitHub main commit for subsequent Production deployments. Local backups and backup schedules are not enabled.

## v0.11.0 — Apps Script version 33

- Make answer entry local-first: one question performs no cloud write, the standard answer appears immediately, and each five revealed answers share one background checkpoint.
- Keep unfinished answers in persistent same-device recovery storage until successful submission, with seven-day stale cleanup; the final submit includes any tail shorter than five.
- Add the Apps Script-owned immutable `Grade Requests` snapshot contract 1.0 and require ChatGPT grading to echo the exact observed answer from that surface.
- Make Apps Script fill the authoritative batch hash, reject identity/answer mismatches, reject negative grades for exact accepted answers, and route positive non-exact grades to confirmation.
- Upgrade grading prompts to `english-review-v4-grade-7` while preserving core Sheet contract 4.0 and the v32 rollback APIs.

## v0.10.0 — Apps Script version 32

- Reorganize the repository into modular server/UI sources with a deterministic five-file Apps Script build.
- Make the HTML shell read-free, split analytics/phrase/system payloads, paginate phrase results and make context-inbox GET lock-free.
- Save answers locally immediately, coalesce cloud drafts into bounded batches and retain exact reveal-lock, conflict and submission gates.
- Retire new error-reinforcement generation and result UI while preserving full-sentence transfer challenges and historical compatibility.
- Add deterministic performance, batching and reinforcement-retirement contract tests.

## v0.9.3 — Apps Script version 31

- Made first-attempt error-reinforcement and full-sentence challenge saves reliable through the shared write queue and bounded busy retry.

## v0.9.2 — Apps Script version 30

- Serialized page-level draft writes, shortened lock waits and added recoverable `BUSY_RETRY` behavior for continuous answering.

## v0.9.1 — Apps Script version 29

- Allowed navigation after immediate standard-answer reveal while preserving cloud-lock submission gates and retry state.

## v0.9.0 — Apps Script version 28

- Added adaptive formal question selection, context variation, error reinforcement and separate full-sentence transfer challenges.

## v0.8.1 — Apps Script version 27

- Prevented partial cloud drafts from silently overwriting complete local answers and established the formal dual-repository release process.

## v0.1.0–v0.8.0

- Established Daily Queue/SRS, the v4 Web App, batch grading, context intake, Dashboard, variable question counts and the initial sanitized public history.
- Exact historical source and deployment evidence remains recoverable from the corresponding Git tags and repository history.

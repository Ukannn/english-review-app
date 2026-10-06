# Changelog

## [0.18.0] - 2026-10-06

- Add revocable, insert-only connections for Apple Shortcuts in Settings. Connections expire after 90 days and cannot read the library or change learning progress.
- Preserve shared text as pending context and make identical request retries return the original receipt. Verify capture capabilities in isolated database CI.

## [0.17.2] - 2026-10-05

- Merge refreshed cloud revisions and checkpoints into an open lesson while preserving local input, unsynced answers and explicit conflict review. Identify older unfinished lessons with their original date.
- Reuse context request keys after an unconfirmed response and make global capture collapsible without losing marked passages or retry state.
- Keep expression detail sheets open when development StrictMode replays modal initialization, while preserving normal close actions.
- Restore archived contexts in the owner-scoped reader and count imported reviews with unknown rule versions as legacy history.
- Give ChatGPT one complete v3 question/reading and grading contract, including every frozen item and required field, while retaining the short pending-task command.
- Support both wrapped and unwrapped management migrations; restrict sanitized public exports to tracked regular files. Refresh development dependencies to clear the audited advisories.

## [0.17.1] - 2026-10-01

- Keep feedback cards at a shared responsive height, with complete long content scrollable inside the active card. Keep carousel controls stable when switching between short and long feedback.
- Reset card reading position on every selection; support mouse, keyboard and native touch scrolling while retaining the existing perspective and carousel animation.

## [0.17.0] - 2026-09-30

- Separate Today, Learning Report and Learning Records while preserving the existing corpus, library, candidates, settings and answer recovery flows.
- Reuse the visual study's portrait 3D carousel and motion. Keep each card's identity, natural height, text selection, side-card selection, keyboard controls, touch swipes and explicit playback after interaction pauses.
- Present evidence-backed spelling errors and corresponding corrections with distinct marks; keep reasonable alternate answers neutral and preserve the original answer and question target.
- Lead the report with version-separated accuracy, one interactive stacked column and scheduled 7/30-day review counts. Read the full expression inventory and describe stages without claiming permanent mastery.
- Add expression-history evidence links, preserved filters and reading position, light/dark/system themes and responsive navigation. The existing API, grading, scheduling and permissions remain unchanged; full session browsing is still unavailable.

## [0.16.0] - 2026-09-30

- Add global text selection capture across reading, questions, references and library detail sheets. Save directly or mark several passages before one batch action.
- Preserve each source paragraph, exact selected spans and page provenance without interrupting the active answer. Merge overlapping selections in the same paragraph.
- Verify saved contexts through inbox readback, retain unconfirmed requests with stable retry keys, and retry only remaining paragraphs after partial success.

## [0.15.1] - 2026-09-29

- Restore selecting multiple unknown passages in the context intake form and save exact source spans for AI extraction.
- Show saved selections in the context inbox; clear stale marks when the source text changes.
- Add an owner-scoped way to discard an unprocessed, unmarked context while preserving it for recovery.

## [0.15.0] - 2026-09-28

- Add frozen review → reading → expression lessons with life/life/work themes, eight default reviews and two short responses.
- Preserve v2 jobs, settings and history; include due mastered phrases and distinguish skipped, unknown, hinted, exposed and full-retrieval evidence.
- Remove private scoring boundaries from answer screens, enforce explicit answer forms, and keep gaps/post-reading practice from advancing mastery.
- Restore local text and cloud stage progress; show separate v3 report denominators, engaged time and a ten-lesson reflection.
- Add isolated database regressions and three sanitized content-review packages. Docker remains test-only; no database backup workflow is introduced.


## v0.14.0 — 2026-09-21

- Prepare all pending contexts with one action and one ChatGPT command instead of opening each context separately.
- Reuse pending extraction jobs, retain successful work when individual requests fail, and reuse request keys on retry.
- Refresh context processing progress automatically and add batch preparation regression tests.

## v0.13.1 — 2026-09-20

- Refresh the active review session after question-count changes without losing local answers or unfinished input; preserve conflict handling and ignore stale responses during checkpoints.
- Add “再生成一批” for completed candidate generation, using a new request key for each batch and preserving the key for retries.
- Add regression coverage for count changes, cloud reconciliation, checkpoint races, and repeat candidate generation.

- Remove local database backup and restore tooling, the npm entrypoint, codec test, and operational runbooks at the owner's request. Browser answer recovery remains part of learning synchronization.

## v0.13.0 — 2026-09-08

- Align English with the Korean frontend hierarchy: Today, Context, Analytics, Library and Sync/Settings share desktop and mobile navigation.
- Keep active answers mounted while navigating; place candidate confirmation inside Library and material generation inside Settings.
- Adopt the warm paper palette, serif headings, restrained accent colors, rounded cards and dark theme.
- Add the English E/book logo across desktop, mobile, authentication, favicon and installed PWA icons.

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

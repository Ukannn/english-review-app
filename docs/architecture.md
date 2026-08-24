# Architecture

## System boundary

English Review is a single-user Google Apps Script application backed by Google Sheets. The Web App, review page, Dashboard, context inbox and system status are views in one `ReviewApp.html`, not separate deployments.

Google Sheets is the formal fact source. Browser state, caches and generated indexes are disposable helpers and must never silently replace Sheet state.

## Runtime layers

1. `代码.js` contains the deterministic Daily Queue v3 selection and setup surface.
2. `ReviewWebAppV4.js` owns the active v4 session, draft, grading, context and Dashboard contracts.
3. `ReviewApp.html` owns navigation, local answer state, retry queues and user feedback.
4. `DailyTaskPrompt.html` defines the manual ChatGPT candidate-generation, question-preparation and grading contract.
5. `appsscript.json` defines the unchanged Apps Script runtime configuration.

The repository source is split by responsibility, but `scripts/apps-script-bundles.json` reconstructs these five files without changing their bytes or remote names.

## Daily Queue and question preparation

- Due Phrase Bank rows are selected first. Ready Candidate Bank rows fill remaining positions; non-due old phrases are not filler.
- Personal context and learning evidence outrank conversation-derived, legacy and AI fallback candidates.
- A Queue ID represents one user-visible daily set. Adjusting the daily target preserves already presented identities and records revision/audit fields.
- AI fallback is created only for an actual shortfall. ChatGPT stages rows; Apps Script validates, deduplicates and assigns formal IDs inside a lock.
- Formal questions test one clear target. Full-sentence writing remains a separate transfer challenge and does not alter formal SRS scheduling.

## Answer and draft state

`revealed`, `syncing` and `locked` are separate states:

- revealing displays the preloaded standard answer immediately;
- the write is serialized through the page-level draft queue;
- `locked` becomes true only after the atomic server operation succeeds;
- a revealed but unlocked answer blocks final submission and remains retryable;
- conflicts preserve the complete page answer by default and require an explicit user choice before loading cloud content.

Draft writes use revision checks, Answer Hash, append-only history, a short `tryLock(1000)` path and machine-readable `BUSY_RETRY`. Draft/history writes are flushed and read back together before success is returned.

## Grading, SRS and transfer practice

- All formal questions must be cloud-locked before batch submission.
- ChatGPT grading is staged separately; Apps Script validates identity, coverage and frozen commit plans before writing formal tables.
- Review Log, Error Log, Phrase Bank and Session Log are the formal analytics sources. Queue, Questions, Grade Inbox and Commit Journal describe planning and pipeline state.
- Commit Journal and exact readback make submission idempotent and recoverable.
- Error reinforcement is retired for new grading batches. Historical reinforcement rows remain intact but are no longer shown in the result UI.
- Full-sentence challenges remain additional practice. Their saves use the same serialized queue and busy retry contract and do not advance SRS a second time.

## Performance contract

- The HTML shell performs no Sheet migration or formula repair; setup owns schema changes.
- Analytics, phrase-library and system-status payloads load independently and use short-lived, disposable caches.
- Context inbox reads are lock-free and read-only; status repair occurs only in explicit write workflows.
- Answer input is backed up locally immediately. Cloud drafts are coalesced into bounded batches, while reveal locking and final submission retain exact revision/readback gates.

## Context intake

Context enters an inbox with exact selected spans and optional source metadata. Candidate suggestions are staged, then explicitly confirmed, edited or rejected by the user. Only accepted candidates enter Candidate Bank; the original context remains the audit source.

## Dashboard

The same page exposes 今日学习、学习分析、我的搭配 and 系统状态. Formal accuracy is computed from committed review results, while queue and journal data are shown only as pipeline diagnostics. Database headers, interface keys and status enums remain English even when display copy is Chinese.

## Compatibility contract

Repository refactoring must not change:

- Apps Script public functions, Script ID, deployment URL or deployment ID;
- the five remote filenames and file types;
- Sheet names, headers, formulas, IDs or status enums;
- queue identity, answer revision, hash, lock, grading or SRS behavior;
- current prompt modes and manual ChatGPT boundary.

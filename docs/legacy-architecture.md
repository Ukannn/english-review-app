# Architecture

## System boundary

English Review is a single-user Google Apps Script application backed by Google Sheets. The Web App, review page, Dashboard, context inbox and system status are views in one `ReviewApp.html`, not separate deployments.

Google Sheets is the formal fact source. Browser recovery is a deliberate same-device buffer for an unfinished answer tail; it never becomes formal SRS state and is deleted after successful submission. Caches and generated indexes remain disposable helpers.

During the Supabase migration this remains the legacy production boundary until the explicit cutover. The new PWA is isolated in `pwa/`: it has its own manifest, Service Worker, IndexedDB recovery and Cloudflare Pages project, and does not load or modify the Korean frontend.

## Supabase target boundary

- Formal English tables live only in the private `english_private` schema; all rows are owner-scoped to `auth.users` and protected by RLS.
- Browsers use a publishable key and call only authorized `english_api` RPC functions. They receive no direct table grants.
- The shared database migration history is released from the separate private platform repository. This application repository keeps only the browser contract and frontend source.
- `ReviewBootstrap`, checkpoint, frozen submission, AI job, confirmation, Dashboard and phrase-library payloads are typed in `pwa/src/lib/contracts.ts`.
- IndexedDB is recovery state, not a second fact source. Revision, idempotency key and frozen hash gates still define formal writes.
- The Apps Script version is made read-only only after the final Sheet snapshot reconciles and the Supabase production workflow is verified.

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

`revealed`, `syncing` and `locked` remain separate states:

- `revealed` freezes the answer in persistent local storage and displays the preloaded standard answer immediately, with no cloud request for one question;
- every five revealed-but-unlocked answers share one serialized `checkpointAnswersV4` request;
- `syncing` covers the five-answer batch and `locked` becomes true only after every checkpoint row and history row is read back;
- a tail shorter than five stays recoverable on the same device and is included atomically in final submission;
- completed checkpoints are recoverable on another device; conflicts preserve the complete local answer and require an explicit choice.

Checkpoint writes validate the whole batch before mutation, use revision checks, per-answer reveal hashes, append-only history, a short `tryLock(1000)` path and machine-readable `BUSY_RETRY`. Draft/history writes are flushed and read back together before success is returned. Legacy single-answer APIs remain available for v32 rollback compatibility and explicit conflict correction.

## Grading, SRS and transfer practice

- All formal questions must be revealed locally before batch submission; the final call writes any unchecked tail and freezes one complete batch hash.
- Apps Script materializes one immutable `Grade Requests` row per submitted answer. It contains the exact observed answer, question, expected/accepted answers, semantic boundary, rubric and pre-grade Review Stage under snapshot contract 1.0.
- ChatGPT reads only `Grade Requests` for grading and stages an exact `Observed Answer` echo in Grade Inbox. Apps Script, not ChatGPT, fills the authoritative Answer Hash.
- Exact accepted answers cannot receive `forgotten` or `difficult`; positive grades for non-exact answers require user confirmation.
- Review Log, Error Log, Phrase Bank and Session Log are the formal analytics sources. Queue, Questions, Grade Requests, Grade Inbox and Commit Journal describe planning and pipeline state.
- Commit Journal and exact readback make submission idempotent and recoverable.
- Error reinforcement is retired for new grading batches. Historical reinforcement rows remain intact but are no longer shown in the result UI.
- Full-sentence challenges remain additional practice. Their saves use the same serialized queue and busy retry contract and do not advance SRS a second time.

## Performance contract

- The HTML shell performs no Sheet migration or formula repair; setup owns schema changes.
- Analytics, phrase-library and system-status payloads load independently and use short-lived, disposable caches.
- Context inbox reads are lock-free and read-only; status repair occurs only in explicit write workflows.
- Answer input and reveal state are persisted locally immediately. Cloud traffic is one request per five completed questions, while final submission retains exact hash, idempotency and readback gates.

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

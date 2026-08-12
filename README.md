# English Review App

A personal English collocation review system built with Google Apps Script, spaced repetition, and ChatGPT-assisted content workflows.

This repository is the public, code-only edition. Personal identifiers, live spreadsheet IDs, deployment URLs, private conversation links, operational handoff notes, and rollback snapshots are intentionally excluded or replaced with placeholders.

## What it includes

- A same-page quiz and learning dashboard
- Daily Queue and spaced-repetition scheduling
- Per-question answer reveal with server-side locking
- Immediate next-question navigation while cloud locking finishes in the background
- Explicit draft-conflict resolution with local answer recovery and append-only history
- Batch grading and formal learning-log updates
- Stage- and error-aware formal questions with explicit answer scope
- Historical context rotation and exact prompt-reuse rejection
- One uncapped, non-recursive reinforcement per formal error outside SRS
- Full-sentence transfer challenges reserved for stable mastery outside SRS
- Personal context intake with human confirmation before candidate promotion
- Prompt contracts for question preparation, grading, and candidate generation

## Main files

- `ReviewWebAppV4.gs` — Apps Script v4 backend
- `ReviewApp.html` — responsive Web App frontend
- `DailyQueue.gs` — queue and SRS foundation
- `DailyTaskPrompt_v4.txt` — daily AI workflow contract
- `ContextProcessingPrompt_v1.txt` — one-time context processing contract
- `CONTEXT_INTAKE_CONTRACT.md` — intake and candidate-confirmation boundaries
- `ADAPTIVE_QUESTION_ENGINE_PRD.md` — adaptive question and extra-practice contract
- `BACKGROUND_SAVE_NAVIGATION_FIX_PRD.md` — immediate reveal and background-lock interaction contract
- `appsscript.json` — Apps Script manifest

## Version history

The public history is reconstructed from verified, sanitized release snapshots. It reflects the real feature sequence without exposing private operational identifiers.

| Version | Milestone |
| --- | --- |
| `v0.1.0` | Context intake foundation |
| `v0.2.0` | Guided context-processing workflow |
| `v0.3.0` | Personal-source candidate priority |
| `v0.4.0` | Three-state intake lifecycle |
| `v0.5.0` | Dynamic daily question count |
| `v0.6.0` | One persistent daily review set |
| `v0.7.0` | Resilient prompt-copy fallback |
| `v0.8.0` | Count-scope and grading workflow |
| `v0.8.1` | Draft-conflict safety and local answer recovery |
| `v0.9.0` | Adaptive question engine and non-SRS extra practice |
| `v0.9.1` | Immediate reveal and next-question navigation during background locking |

Every public version is published through a branch and pull request, then receives a matching tag and GitHub Release. Google Apps Script deployment numbers are operational identifiers and are intentionally separate from these semantic project versions.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the required change and release workflow.

## Before deployment

Search for the following placeholders and configure them only in a private deployment environment:

- `YOUR_SPREADSHEET_ID`
- `YOUR_BASELINE_SPREADSHEET_ID`
- `YOUR_WEB_APP_URL`
- `owner@example.invalid`

Do not commit real account emails, Google resource IDs, deployment URLs, OAuth state, or private rollback material to a public fork.

## Verification

The public source preserves the application structure but does not prove the state of any live Google Sheet, Apps Script deployment, or scheduled workflow. Production changes require an authenticated deployment followed by exact source and runtime readback.

## License

No open-source license is currently granted. The source is published for inspection and learning reference only.

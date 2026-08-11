# English Review App

A personal English collocation review system built with Google Apps Script, spaced repetition, and ChatGPT-assisted content workflows.

This repository is the public, code-only edition. Personal identifiers, live spreadsheet IDs, deployment URLs, private conversation links, operational handoff notes, and rollback snapshots are intentionally excluded or replaced with placeholders.

## What it includes

- A same-page quiz and learning dashboard
- Daily Queue and spaced-repetition scheduling
- Per-question answer reveal with server-side locking
- Batch grading and formal learning-log updates
- Personal context intake with human confirmation before candidate promotion
- Prompt contracts for question preparation, grading, and candidate generation

## Main files

- `ReviewWebAppV4.gs` — Apps Script v4 backend
- `ReviewApp.html` — responsive Web App frontend
- `DailyQueue.gs` — queue and SRS foundation
- `DailyTaskPrompt_v4.txt` — daily AI workflow contract
- `ContextProcessingPrompt_v1.txt` — one-time context processing contract
- `CONTEXT_INTAKE_CONTRACT.md` — intake and candidate-confirmation boundaries
- `appsscript.json` — Apps Script manifest

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

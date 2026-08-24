# English Review App

A Google Apps Script collocation-review system with deterministic Daily Queue selection, review sessions, draft locking, batch grading, SRS, context intake, extra practice, and a same-page learning dashboard.

The repository contains modular source files. A deterministic build reconstructs the five flat files expected by Apps Script without changing the `v0.9.3` runtime behavior.

## Build and test

Node.js 24 is required.

```bash
npm ci
npm run build
npm test
npm run check:public
```

Generated files are written to ignored `dist/`:

- `ReviewWebAppV4.js`
- `ReviewApp.html`
- `DailyTaskPrompt.html`
- `代码.js`
- `appsscript.json`

## Source map

- `src/server/` — Apps Script modules grouped by runtime responsibility.
- `src/ui/` — HTML shell, CSS and browser JavaScript.
- `prompts/` — current manual ChatGPT prompt contracts.
- `tests/` — runtime, bundle and sanitization contracts.
- [`docs/architecture.md`](docs/architecture.md) — system and compatibility contracts.
- [`CHANGELOG.md`](CHANGELOG.md) — project and Apps Script version history.

## Configure your copy

The public source uses placeholders such as `YOUR_SPREADSHEET_ID`, `YOUR_BASELINE_SPREADSHEET_ID` and `YOUR_WEB_APP_URL`. Replace them only in your private deployment configuration/source. Keep `.clasp.json`, OAuth credentials and live resource IDs out of Git.

This repository is a sanitized source distribution. It does not contain the private deployment, learning data, operational history or rollback material.

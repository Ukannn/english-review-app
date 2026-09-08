# English Review App

A standalone English collocation-learning system built with React PWA, Supabase and Cloudflare Pages. It supports material intake, candidate confirmation, manual ChatGPT JSON handoff, hints, five-answer checkpoints, transparent spaced review and learning analysis.

Version `v0.12.0` introduces the independent application and migration tools. The legacy Apps Script source and its deterministic five-file `v0.11.0` build remain available as a historical baseline; active learning uses the PWA.

## Build and test

Node.js 24 is required.

```bash
npm ci
npm --prefix pwa ci
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

## React PWA

The `pwa/` directory contains the standalone React, TypeScript and Vite client for the Supabase-backed version. It talks only to the `english_api` RPC schema and does not contain database deployment credentials. Copy `pwa/.env.example` to a local `.env`, provide your own Supabase URL and publishable key, then run:

```bash
npm --prefix pwa ci
VITE_DEMO_MODE=true npm --prefix pwa run dev
npm --prefix pwa run check
```

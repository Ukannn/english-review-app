# English Review App

界面沿用韩语项目的五页结构：今日学习、语料、学习报告、学习资料库、同步与设置。桌面侧栏与手机底栏共享导航，答题与批改留在今日学习，候选确认位于资料库，素材生成位于设置。统一使用暖纸色、衬线标题与深蓝强调色，并提供深色模式；E / 书页 Logo 同步用于网页、登录页与安装图标。

A standalone English collocation-learning system built with React PWA, Supabase and Cloudflare Pages. It supports material intake, candidate confirmation, connected ChatGPT processing with a short command and automatic refresh, hints, five-answer checkpoints, transparent spaced review and learning analysis.

Version `v0.12.1` removes manual JSON entry. Version `v0.12.0` introduces the independent application and migration tools. The legacy Apps Script source and its deterministic five-file `v0.11.0` build remain available as a historical baseline; active learning uses the PWA.

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

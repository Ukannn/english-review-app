# Changelog

Project semantic versions and Google Apps Script immutable versions are separate identifiers.

## Unreleased

- Reorganize the repository into modular server/UI sources with a deterministic five-file Apps Script build.
- Replace checked-in rollback snapshots and scattered PRDs with architecture, operations and changelog documentation.
- Add reproducible private/public baseline checks, CI and sanitized public export tooling.
- Runtime behavior and the active Apps Script deployment remain unchanged at `v0.9.3` / version 31.

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

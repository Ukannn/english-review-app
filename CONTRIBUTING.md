# Contributing

This project uses a pull-request workflow even when a change has a single maintainer.

## Change workflow

1. Start from the latest `main` and create a focused `fix/*`, `feature/*`, or `release/*` branch.
2. Make one scoped change and run the relevant syntax and contract checks.
3. Commit intentionally and push the branch. Do not push a release change directly to `main`.
4. Open a pull request describing the motivation, user impact, tests, privacy boundary, and rollback approach.
5. Review the complete diff and checks before merging.
6. Delete the merged branch. For a release, tag the merge commit and create a matching GitHub Release.

## Public-repository boundary

Pull requests must not contain personal emails, spreadsheet or deployment IDs, live Web App URLs, private conversation links, local filesystem paths, `.clasp.json`, production data, operational handoff notes, or rollback snapshots. Use documented placeholders and keep deployable configuration outside the repository.

Project releases use semantic versions (`vMAJOR.MINOR.PATCH`). Google Apps Script deployment versions are tracked separately and must not be used as GitHub project version numbers.

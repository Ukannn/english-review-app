# Background Save Navigation Fix PRD

Project version: v0.9.1

## Problem

The draft-conflict safety patch moved the local `revealed` state behind the cloud lock response. The primary next-question action is shown from `revealed`, so users had to wait for the complete network round trip even though `locked` already existed as the submission-safety state.

## Goal

When the user clicks the reveal-and-lock action:

1. Keep the current answer in the session-scoped browser backup.
2. Reveal the preloaded standard answer immediately.
3. Make the next-question action available immediately.
4. Continue autosave draining, revision validation, cloud locking, and exact readback in the background.
5. Keep final submission blocked until every required question is cloud-locked.

## Non-goals

- No Sheet schema or backend API changes.
- No queue, grading, SRS, extra-practice, or context-flow changes.
- No automatic cloud-draft adoption.
- No bypass of the final locked-answer gate.

## State contract

| State | Meaning | Allowed behavior |
| --- | --- | --- |
| `revealed=true, syncing=true, locked=false` | Feedback is visible; cloud save/lock is pending | Navigate and answer other questions; do not submit |
| `revealed=true, syncing=false, locked=true` | Cloud lock and readback completed | Count progress and allow submission when all required questions match |
| `revealed=true, syncing=false, locked=false, syncError=true` | Feedback is visible; cloud lock failed | Navigate, retry this question, do not submit |
| `conflict[position]` exists | The cloud revision or locked answer differs | Require an explicit conflict decision before submission |

`revealed` controls feedback and navigation. `locked` remains the only per-question submission qualification.

## Acceptance criteria

1. During simulated cloud latency, the standard answer and next-question action are visible before the lock Promise resolves, while progress still excludes the pending question.
2. The user can enter an answer on the next question while the previous lock completes; background completion must not navigate back.
3. A lock failure preserves the visible standard answer, exposes retry, and remains excluded from progress and submission.
4. A revision conflict preserves the current complete answer and browser backup until the user explicitly chooses a version.
5. The delayed-autosave regression preserves the latest complete value and does not create a false conflict.
6. Static contract checks, inline JavaScript syntax, responsive layout, and console checks pass.

## Rollback

Redeploy the previous known-good source snapshot. No data migration or cleanup is required.

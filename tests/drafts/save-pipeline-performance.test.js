const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'ReviewApp.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'ReviewWebAppV4.js'), 'utf8');

assert.match(
  html,
  /var DRAFT_AUTOSAVE_DELAY_MS = 750;/,
  'local-first cloud autosave debounce must be 750ms'
);
assert.match(
  html,
  /draftWriteTail: Promise\.resolve\(\)/,
  'all page-level draft writes must share one queue tail'
);
assert.match(
  html,
  /function enqueueDraftWrite\(name, args\)[\s\S]*app\.draftWriteTail = queued\.catch/,
  'the draft queue must continue after either success or failure'
);
assert.match(
  html,
  /function callDraftServerWithRetry[\s\S]*result\.code !== "BUSY_RETRY"[\s\S]*DRAFT_BUSY_MAX_RETRIES/,
  'BUSY_RETRY must use bounded automatic retries'
);
assert.match(
  html,
  /var pendingSave = app\.savePromises\[question\.position\] \|\| Promise\.resolve\(\);/,
  'reveal must only wait for an autosave that was already in flight'
);
assert.match(
  html,
  /revealDraft\.revision > revealRevision &&[\s\S]*revealDraft\.answer !== args\[2\]/,
  'demo must model exact-revision atomic replacement of a partial autosave'
);
assert.match(
  html,
  /function enqueueDraftSave\(args\)[\s\S]*pendingDraftBatch\[position\]/,
  'autosaves must coalesce the latest unsent value per position'
);
assert.match(
  html,
  /function flushDraftBatch\(\)[\s\S]*enqueueDraftWrite\("saveDraftBatchV4"/,
  'coalesced autosaves must use one bounded server batch through the global queue'
);
assert.match(
  html,
  /enqueueDraftWrite\("revealAnswerV4"/,
  'answer locks must use the global draft queue'
);
assert.match(
  html,
  /enqueueDraftWrite\("replaceLockedDraftV4"/,
  'locked-answer corrections must use the global draft queue'
);
assert.match(
  html,
  /enqueueDraftWrite\("submitExtraPracticeV4"/,
  'extra-practice submissions must use the same global write queue'
);
assert.match(
  html,
  /var isDraftWrite = \[[\s\S]*"saveDraftBatchV4"[\s\S]*"submitExtraPracticeV4"[\s\S]*\][\s\S]*\.indexOf\(name\) !== -1/,
  'demo busy-lock injection must cover extra-practice submissions'
);

assert.match(
  backend,
  /function saveDraftBatchV4\(sessionId, drafts, clientInfo\)[\s\S]*drafts\.length > 20[\s\S]*saveDraftV4\(/,
  'server draft batches must be bounded and preserve the single-draft contract'
);
assert.match(
  backend,
  /function stageDraftHistoriesV4_[\s\S]*createTextFinder\(historyId\)[\s\S]*matchEntireCell\(true\)/,
  'history idempotency must use an exact lookup instead of loading the full history sheet'
);

for (const functionName of [
  'saveDraftV4',
  'revealAnswerV4',
  'replaceLockedDraftV4',
  'submitExtraPracticeV4'
]) {
  const start = backend.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const snippet = backend.slice(start, start + 640);
  assert.match(snippet, /lock\.tryLock\(1000\)/, `${functionName} must fail fast when the lock is busy`);
  assert.match(snippet, /draftBusyResponseV4_\(\)/, `${functionName} must return BUSY_RETRY`);
  assert.doesNotMatch(snippet, /waitLock\((15000|30000)\)/, `${functionName} must not use a long lock wait`);
}

assert.match(
  backend,
  /function draftBusyResponseV4_\(\)[\s\S]*code: 'BUSY_RETRY'/,
  'backend busy responses must be machine-readable'
);
assert.match(
  backend,
  /current\.revision > expectedRevision && current\.answer !== answer/,
  'atomic reveal must replace a partial autosave only at the exact known revision'
);
assert.match(
  backend,
  /stageDraftHistoriesV4_\([\s\S]*SpreadsheetApp\.flush\(\);[\s\S]*verifyStagedDraftHistoriesV4_/,
  'draft and history writes must share a flush before exact readback'
);

console.log('save pipeline performance contract: PASS');

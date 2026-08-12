const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'ReviewApp.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'ReviewWebAppV4.gs'), 'utf8');

assert.match(
  html,
  /var DRAFT_AUTOSAVE_DELAY_MS = 2000;/,
  'cloud autosave debounce must be two seconds'
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
  /enqueueDraftWrite\("saveDraftV4"/,
  'autosaves must use the global draft queue'
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

for (const functionName of ['saveDraftV4', 'revealAnswerV4', 'replaceLockedDraftV4']) {
  const start = backend.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const snippet = backend.slice(start, start + 320);
  assert.match(snippet, /lock\.tryLock\(1000\)/, `${functionName} must fail fast when the lock is busy`);
  assert.match(snippet, /draftBusyResponseV4_\(\)/, `${functionName} must return BUSY_RETRY`);
  assert.doesNotMatch(snippet, /waitLock\(15000\)/, `${functionName} must not wait fifteen seconds`);
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'ReviewApp.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'ReviewWebAppV4.js'), 'utf8');

assert.match(html, /var ANSWER_CHECKPOINT_SIZE = 5;/);
assert.match(html, /var LOCAL_BACKUP_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
assert.match(html, /localStorage\.setItem\(draftBackupKey/,
  'same-device recovery must survive page and browser restarts');
assert.match(html, /now - updatedAt > LOCAL_BACKUP_MAX_AGE_MS/,
  'stale local recovery must expire after seven days');

const input = html.slice(html.indexOf('function onAnswerInput()'), html.indexOf('function savePosition('));
assert.doesNotMatch(input, /setTimeout|savePosition|enqueueDraft|callServer/,
  'typing one answer must remain entirely local');

const checkpoint = html.slice(
  html.indexOf('function maybeCheckpointAnswers()'),
  html.indexOf('function reviewBeforeSubmit()')
);
assert.match(checkpoint, /slice\(0, ANSWER_CHECKPOINT_SIZE\)/);
assert.match(checkpoint, /pending\.length < ANSWER_CHECKPOINT_SIZE/);
assert.match(checkpoint, /enqueueDraftWrite\("checkpointAnswersV4"/);
assert.match(checkpoint, /question\.locked = true;/,
  'checkpoint status must only advance after exact server readback');

assert.match(html, /\(app\.checkpointPromise \|\| Promise\.resolve\(\)\)\.then/,
  'final submit must wait for any in-flight checkpoint');
assert.match(html, /clearDraftBackup\(payload\.sessionId\)/,
  'successful submission must clear persistent recovery');

const serverCheckpoint = backend.slice(
  backend.indexOf('function checkpointAnswersV4('),
  backend.indexOf('function saveDraftV4(')
);
assert.match(serverCheckpoint, /answers\.length > ER4\.checkpointSize/);
assert.match(serverCheckpoint, /if \(conflicts\.length\)[\s\S]*return \{ ok: false, conflict: true/,
  'all conflicts must be detected before checkpoint writes');
assert.match(serverCheckpoint, /eventType: 'checkpoint_lock'/);
assert.match(serverCheckpoint, /Checkpoint readback failed at position/);

for (const functionName of ['saveDraftV4', 'revealAnswerV4', 'replaceLockedDraftV4', 'checkpointAnswersV4']) {
  assert.notEqual(backend.indexOf(`function ${functionName}(`), -1, `${functionName} must remain available`);
}

console.log('five-answer checkpoint performance contract: PASS');

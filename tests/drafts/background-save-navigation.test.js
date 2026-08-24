const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'ReviewApp.html'), 'utf8');
const revealStart = source.indexOf('function revealCurrentAnswer()');
const revealEnd = source.indexOf('function maybeCheckpointAnswers()', revealStart);
const reveal = source.slice(revealStart, revealEnd);

assert.notEqual(revealStart, -1, 'revealCurrentAnswer must exist');
assert.notEqual(revealEnd, -1, 'checkpoint boundary must exist');
assert.match(reveal, /question\.revealed = true;/, 'standard answer must be revealed locally');
assert.match(reveal, /persistDraftBackup\([\s\S]*revealed: true/, 'revealed answer must be persisted locally');
assert.match(reveal, /maybeCheckpointAnswers\(\);/, 'local reveal must offer the answer to the checkpoint collector');
assert.doesNotMatch(reveal, /callServer\(|enqueueDraftWrite\(/,
  'a single reveal must not directly issue a cloud request');
assert.match(source, /ANSWER_CHECKPOINT_SIZE = 5;/, 'checkpoint size must be five');
assert.match(source, /!question\.revealed \|\| app\.current === app\.questions\.length - 1/,
  'next button must be driven by immediate local reveal');
assert.match(source, /var locked = app\.questions\.filter\(function \(question\) \{ return question\.revealed; \}\);/,
  'final review must include every locally frozen answer, including the tail');

console.log('local reveal navigation contract: PASS');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ReviewApp.html'), 'utf8');
const revealStart = source.indexOf('function revealCurrentAnswer()');
const revealEnd = source.indexOf('function reviewBeforeSubmit()', revealStart);

assert.notEqual(revealStart, -1, 'revealCurrentAnswer must exist');
assert.notEqual(revealEnd, -1, 'reviewBeforeSubmit boundary must exist');

const reveal = source.slice(revealStart, revealEnd);
const localReveal = reveal.indexOf('question.revealed = true;');
const saveStart = reveal.indexOf('savePosition(question.position).then');
const cloudLock = reveal.indexOf('question.locked = true;');

assert.ok(localReveal >= 0, 'standard answer must be revealed locally');
assert.ok(saveStart > localReveal, 'local reveal must happen before cloud save starts');
assert.ok(cloudLock > saveStart, 'locked must only be set after the cloud chain resolves');
assert.match(
  source,
  /!question\.revealed \|\| app\.current === app\.questions\.length - 1/,
  'next button must be shown from revealed, not locked'
);
assert.match(
  source,
  /el\.nextBtn\.disabled = app\.busy;/,
  'per-question syncing must not disable the next button'
);
assert.match(
  source,
  /return item\.revealed && !item\.locked;/,
  'revealed but unlocked questions must continue blocking submission'
);
assert.match(
  reveal,
  /question\.syncError = true;[\s\S]*标准答案已显示，但本题尚未锁定/,
  'lock failure must preserve visible feedback and expose retry state'
);

console.log('background-save navigation contract: PASS');

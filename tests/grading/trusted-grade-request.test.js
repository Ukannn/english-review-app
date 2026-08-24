const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const backend = fs.readFileSync(path.join(root, 'dist', 'ReviewWebAppV4.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'dist', 'DailyTaskPrompt.html'), 'utf8');

assert.match(backend, /gradeRequestSheet: 'Grade Requests'/);
assert.match(backend, /gradingSnapshotVersion: '1\.0'/);
assert.match(backend, /var ER4_GRADE_REQUEST_HEADERS = \[[\s\S]*'Observed Answer'[\s\S]*'Snapshot Contract Version'/);
assert.match(backend, /function ensureGradeRequestsForJournalV4_/);
assert.match(backend, /ensureGradeRequestsForJournalV4_\(ss, journal\);/,
  'submission/status processing must materialize the trusted snapshot');
assert.match(backend, /observedAnswer !== draft\.answer[\s\S]*observedAnswer !== gradeRequest\.observedAnswer/,
  'staged grades must echo the frozen answer exactly');
assert.match(backend, /Exact accepted answer cannot be graded/);
assert.match(backend, /confidence < ER4\.lowConfidenceThreshold \|\| positiveNonMatch/,
  'positive grades for non-exact answers must require confirmation');
assert.match(backend, /setValue\(journal\.answerHash\)/,
  'Apps Script must own authoritative hash insertion');

assert.match(prompt, /只从 Apps Script 生成的 Grade Requests 读取本次不可变批改快照/);
assert.match(prompt, /Answer Hash 必须留空，由 Apps Script/);
assert.match(prompt, /每行严格 20 个 CellData/);
assert.match(prompt, /Extra Practice JSON \| Observed Answer/);
assert.doesNotMatch(
  prompt.slice(prompt.indexOf('grading：按实际提交的答案集合批改')),
  /回读并联结冻结数据：/,
  'grading must not reconstruct snapshots by joining mutable surfaces'
);

console.log('trusted grade request contract: PASS');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const lessons = JSON.parse(fs.readFileSync('tests/fixtures/english-v3-lessons.json', 'utf8'));
test('three reviewed packages separate reading from ten tasks and cover life/life/work', () => {
  assert.deepEqual(lessons.map(x => x.theme), ['life', 'life', 'work']);
  for (const lesson of lessons) {
    const words = lesson.material.body.trim().split(/\s+/).length;
    assert.ok(words >= 120 && words <= 180);
    assert.equal(lesson.items.filter(x => x.phase === 'review').length, 8);
    assert.equal(lesson.items.filter(x => x.phase === 'expression' && x.answerForm === 'response').length, 2);
    assert.ok(lesson.material.targetPhraseIds.length >= 2 && lesson.material.targetPhraseIds.length <= 3);
    assert.equal(lesson.material.notes.length, lesson.material.targetPhraseIds.length);
  }
});

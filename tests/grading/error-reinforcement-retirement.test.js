const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'dist', 'ReviewApp.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'dist', 'ReviewWebAppV4.js'), 'utf8');
const prompt = fs.readFileSync(path.join(root, 'dist', 'DailyTaskPrompt.html'), 'utf8');

assert.match(prompt, /Prompt Version=english-review-v4-grade-6/,
  'new grading batches must use the reinforcement-free prompt version');
assert.match(prompt, /错误强化模块已停用/);
assert.match(prompt, /practiceType（只能是 sentence_challenge）/);
assert.doesNotMatch(prompt, /每个 Result=forgotten 或 difficult[\s\S]{0,80}reinforcement/,
  'new grading must not require one reinforcement per formal error');

const planBuilder = backend.slice(
  backend.indexOf('function createCommitPlanV4_'),
  backend.indexOf('function buildExtraPracticePlanV4_')
);
assert.doesNotMatch(planBuilder, /buildExtraPracticePlanV4_\([^\n]+reinforcement/,
  'commit plans must not create new reinforcement practice');
assert.match(planBuilder, /sentence_challenge/,
  'sentence transfer challenges must remain available');

const renderPractice = html.slice(
  html.indexOf('function renderExtraPracticeSection('),
  html.indexOf('function renderResultSection(')
);
assert.doesNotMatch(renderPractice, /错误强化|practiceType === "reinforcement"/,
  'result UI must not render error reinforcement');
assert.match(renderPractice, /完整句迁移挑战/);

assert.match(backend, /\['reinforcement', 'sentence_challenge'\]/,
  'legacy reinforcement payloads remain parseable for in-flight compatibility');
assert.match(backend, /function submitExtraPracticeV4\(/,
  'historical extra-practice API remains available without deleting old data');

console.log('error reinforcement retirement contract: PASS');

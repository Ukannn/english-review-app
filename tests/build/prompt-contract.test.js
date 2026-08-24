const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const backend = fs.readFileSync(path.join(root, 'dist', 'ReviewWebAppV4.js'), 'utf8');
const start = backend.indexOf('var ER4_CONTEXT_PROCESSING_PROMPT = [');
const terminator = "].join('\\n');";
const end = backend.indexOf(terminator, start) + terminator.length;
assert.ok(start >= 0 && end >= terminator.length, 'runtime context prompt must be extractable');

const context = {};
vm.runInNewContext(backend.slice(start, end), context);
const runtimePrompt = context.ER4_CONTEXT_PROCESSING_PROMPT;
const externalPrompt = fs.readFileSync(path.join(root, 'prompts', 'context-processing.txt'), 'utf8');

// The deployed runtime contract additionally names Answer Draft History. Preserve
// that production-only guard while ensuring the two prompt copies cannot drift elsewhere.
const normalizedRuntime = runtimePrompt
  .replace('、Answer Draft History', '')
  .replaceAll('YOUR_WEB_APP_URL?view=intake', 'YOUR_WEB_APP_URL')
  .trim();
assert.equal(normalizedRuntime, externalPrompt.trim(), 'context prompt contracts must remain aligned');

console.log('prompt contract: PASS');

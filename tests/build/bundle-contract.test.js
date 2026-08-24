const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'apps-script-bundles.json'), 'utf8')
);
const expectedOutputs = [
  'DailyTaskPrompt.html',
  'ReviewApp.html',
  'ReviewWebAppV4.js',
  'appsscript.json',
  '代码.js'
].sort();
const outputs = manifest.bundles.map((bundle) => bundle.output).sort();
assert.deepEqual(outputs, expectedOutputs, 'bundle outputs must match the remote five-file contract');

const parts = manifest.bundles.flatMap((bundle) => bundle.parts);
assert.equal(new Set(parts).size, parts.length, 'every source fragment must be used only once');
for (const part of parts) {
  assert.ok(fs.existsSync(path.join(root, part)), `missing bundle part: ${part}`);
}

const distFiles = fs.readdirSync(path.join(root, 'dist')).sort();
assert.deepEqual(distFiles, expectedOutputs, 'dist must contain only the remote five-file set');
assert.equal(
  fs.readFileSync(path.join(root, 'dist', 'DailyTaskPrompt.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'prompts', 'daily-task.txt'), 'utf8'),
  'DailyTaskPrompt.html must be generated from the single prompt source'
);

console.log('bundle contract: PASS');

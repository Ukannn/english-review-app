const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'english-public-export-test-'));
const target = path.join(temporaryRoot, 'export');
fs.mkdirSync(target);

try {
  execFileSync(process.execPath, ['scripts/export-public.mjs', '--target', target], {
    cwd: root,
    stdio: 'pipe'
  });
  execFileSync(process.execPath, ['scripts/build-apps-script.mjs'], {
    cwd: target,
    stdio: 'pipe'
  });
  execFileSync(process.execPath, ['scripts/verify-baseline.mjs', '--profile', 'public'], {
    cwd: target,
    stdio: 'pipe'
  });
  execFileSync(process.execPath, ['scripts/check-links.mjs'], {
    cwd: target,
    stdio: 'pipe'
  });
  execFileSync(process.execPath, ['scripts/check-privacy.mjs', '--profile', 'public'], {
    cwd: target,
    stdio: 'pipe'
  });

  assert.ok(!fs.existsSync(path.join(target, 'docs', 'operations.md')));
  assert.ok(!fs.existsSync(path.join(target, '.clasp.json')));
  assert.ok(fs.existsSync(path.join(target, '.github', 'workflows', 'ci.yml')));
  assert.match(
    fs.readFileSync(path.join(target, 'src', 'server', 'config', 'review-contract.gs'), 'utf8'),
    /YOUR_SPREADSHEET_ID/
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('public export contract: PASS');

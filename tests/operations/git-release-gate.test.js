const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');

test('production rejects dirty, unpublished and outdated commits against the real remote', async () => {
  const {assertProductionSource} = await import('../../scripts/operations/git-release-gate.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'english-release-gate-'));
  const root = path.join(base, 'source'), remote = path.join(base, 'remote.git');
  fs.mkdirSync(root);
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    git(['init', '--initial-branch=main']);
    git(['config', 'user.name', 'Release test']);
    git(['config', 'user.email', 'owner@example.invalid']);
    git(['init', '--bare', remote]);
    git(['remote', 'add', 'origin', remote]);
    fs.writeFileSync(path.join(root, 'source.txt'), 'released\n');
    git(['add', '.']); git(['commit', '-m', 'Released source']); git(['push', 'origin', 'main']);
    const released = git(['rev-parse', 'HEAD']);
    assert.equal(assertProductionSource(root), released);
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'uncommitted\n');
    assert.throws(() => assertProductionSource(root), /clean committed/);
    git(['add', '.']); git(['commit', '-m', 'Unpublished source']);
    assert.throws(() => assertProductionSource(root), /merged origin\/main/);
    git(['push', 'origin', 'main']);
    assert.equal(assertProductionSource(root), git(['rev-parse', 'HEAD']));
    git(['checkout', '--detach', released]);
    assert.throws(() => assertProductionSource(root), /merged origin\/main/);
  } finally { fs.rmSync(base, {recursive: true, force: true}); }
});

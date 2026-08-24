import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const profileFlag = process.argv.indexOf('--profile');
const profile = profileFlag === -1 ? 'private' : process.argv[profileFlag + 1];
if (!['private', 'public'].includes(profile)) throw new Error('Profile must be private or public');
const root = process.cwd();
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'baselines', `${profile}.json`), 'utf8')
);

const actualFiles = fs.readdirSync(path.join(root, 'dist')).sort();
const expectedFiles = Object.keys(baseline.files).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Baseline file set mismatch: ${actualFiles.join(', ')}`);
}

for (const [file, expectedHash] of Object.entries(baseline.files)) {
  const content = fs.readFileSync(path.join(root, 'dist', file));
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');
  if (actualHash !== expectedHash) throw new Error(`${file} differs from ${profile} baseline`);
}

console.log(`${profile} release baseline: PASS`);

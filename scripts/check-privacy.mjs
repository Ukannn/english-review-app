import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const profileFlag = process.argv.indexOf('--profile');
const profile = profileFlag === -1 ? 'private' : process.argv[profileFlag + 1];
if (!['private', 'public'].includes(profile)) throw new Error('Profile must be private or public');
const root = process.cwd();
const forbiddenEntries = ['.clasprc.json', 'rollback', 'archive', '.playwright-cli', 'output'];
for (const entry of forbiddenEntries) {
  if (fs.existsSync(path.join(root, entry))) throw new Error(`Forbidden repository entry: ${entry}`);
}

if (profile === 'private' && fs.existsSync(path.join(root, '.clasp.json'))) {
  execFileSync('git', ['check-ignore', '-q', '.clasp.json'], { cwd: root });
}

if (profile === 'public') {
  if (fs.existsSync(path.join(root, '.clasp.json'))) throw new Error('Public export contains .clasp.json');
  if (fs.existsSync(path.join(root, 'docs', 'operations.md'))) {
    throw new Error('Private operations guide must not be exported');
  }
  const ignored = new Set(['.git', 'node_modules']);
  const patterns = [
    /\/Users\/[A-Za-z0-9._-]+\//,
    /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+/,
    /https:\/\/chatgpt\.com\/(?:c|g|share)\//,
    /[A-Za-z0-9._%+-]+@(?!example\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
  ];
  const failures = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else {
        const content = fs.readFileSync(fullPath);
        if (content.includes(0)) continue;
        const text = content.toString('utf8');
        if (patterns.some((pattern) => pattern.test(text))) failures.push(path.relative(root, fullPath));
      }
    }
  }
  walk(root);
  if (failures.length) throw new Error(`Public privacy scan failed: ${[...new Set(failures)].join(', ')}`);
}

console.log(`${profile} privacy boundaries: PASS`);

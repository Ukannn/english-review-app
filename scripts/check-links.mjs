import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignored = new Set(['.git', 'dist', 'node_modules', 'output', '.playwright-cli', '.wrangler']);
const markdownFiles = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (path.relative(root, fullPath) === path.join('scripts', 'public')) continue;
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith('.md')) markdownFiles.push(fullPath);
  }
}
walk(root);

const failures = [];
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)} -> ${target}`);
  }
}
if (failures.length) throw new Error(`Broken Markdown links:\n${failures.join('\n')}`);
console.log('Markdown links: PASS');

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'scripts', 'apps-script-bundles.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const outputDir = path.join(root, 'dist');
const seenParts = new Set();
const seenOutputs = new Set();

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const bundle of manifest.bundles) {
  if (seenOutputs.has(bundle.output)) throw new Error(`Duplicate output: ${bundle.output}`);
  seenOutputs.add(bundle.output);
  let content = '';
  for (const relativePart of bundle.parts) {
    if (seenParts.has(relativePart)) throw new Error(`Part used more than once: ${relativePart}`);
    seenParts.add(relativePart);
    content += fs.readFileSync(path.join(root, relativePart), 'utf8');
  }
  fs.writeFileSync(path.join(outputDir, bundle.output), content);
}

const actual = fs.readdirSync(outputDir).sort();
const expected = manifest.bundles.map((bundle) => bundle.output).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected dist files: ${actual.join(', ')}`);
}

console.log(`Built ${actual.length} Apps Script files.`);

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

  const source=path.join(temporaryRoot,'source');fs.mkdirSync(source);
  const git=args=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:'pipe'});
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const relative of tracked){const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,relative),file);}
  git(['init']);git(['add','.']);
  for(const relative of ['pwa/src/untracked-note.txt','prompts/README 2.md','supabase/migrations/20261005090000_english_audit_repairs 2.sql']){
    fs.writeFileSync(path.join(source,relative),'untracked private material\n');
  }
  execFileSync(process.execPath,['scripts/export-public.mjs','--target',path.join(temporaryRoot,'filtered')],{cwd:source,stdio:'pipe'});
  for(const relative of ['pwa/src/untracked-note.txt','prompts/README 2.md','supabase/migrations/20261005090000_english_audit_repairs 2.sql']){
    assert.ok(!fs.existsSync(path.join(temporaryRoot,'filtered',relative)),relative+' must not be exported');
  }
  assert.ok(fs.existsSync(path.join(temporaryRoot,'filtered','pwa/src/components/LessonView.tsx')));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('public export contract: PASS');

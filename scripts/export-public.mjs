import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const targetFlag = process.argv.indexOf('--target');
if (targetFlag === -1 || !process.argv[targetFlag + 1]) {
  throw new Error('Usage: node scripts/export-public.mjs --target <empty-directory>');
}
const target = path.resolve(process.argv[targetFlag + 1]);
if (target === root || target === path.parse(target).root) throw new Error('Unsafe export target');
fs.mkdirSync(target, { recursive: true });
if (fs.readdirSync(target).length !== 0) throw new Error('Public export target must be empty');

const copyEntries = [
  'src',
  'prompts',
  'tests',
  'scripts',
  'docs/architecture.md',
  'CHANGELOG.md',
  'package.json',
  'package-lock.json',
  '.nvmrc',
  '.gitignore'
];

for (const relativePath of copyEntries) {
  const source = path.join(root, relativePath);
  const destination = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}
fs.copyFileSync(path.join(root, 'scripts/public/README.md'), path.join(target, 'README.md'));
fs.mkdirSync(path.join(target, '.github/workflows'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts/public/ci.yml'), path.join(target, '.github/workflows/ci.yml'));

function replaceExact(relativePath, pattern, replacement, label) {
  const file = path.join(target, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const matches = source.match(pattern) || [];
  if (matches.length === 0 && source.split(replacement).length === 2) return;
  if (matches.length !== 1) throw new Error(`${label} expected one match, found ${matches.length}`);
  fs.writeFileSync(file, source.replace(pattern, replacement));
}

replaceExact(
  'src/server/config/review-contract.gs',
  /contextProcessingConversationUrl: '[^']+'/g,
  "contextProcessingConversationUrl: 'https://chatgpt.com/'",
  'context conversation URL'
);
replaceExact(
  'src/server/config/review-contract.gs',
  /"- Spreadsheet ID：[^"\n]+"/g,
  '"- Spreadsheet ID：YOUR_SPREADSHEET_ID"',
  'embedded spreadsheet ID'
);
replaceExact(
  'src/server/config/review-contract.gs',
  /"- 语料箱：[^"\n]+"/g,
  '"- 语料箱：YOUR_WEB_APP_URL?view=intake"',
  'embedded intake URL'
);
replaceExact(
  'src/server/config/review-contract.gs',
  /"“语料整理暂存已完成。请返回语料箱确认要加入候选池的表达：[^"\n]+”"/g,
  '"“语料整理暂存已完成。请返回语料箱确认要加入候选池的表达：YOUR_WEB_APP_URL?view=intake”"',
  'embedded intake completion URL'
);
replaceExact(
  'src/server/setup/review-setup.gs',
  /Session\.getEffectiveUser\(\)\.getEmail\(\) \|\| '[^']+'/g,
  "Session.getEffectiveUser().getEmail() || 'owner@example.invalid'",
  'owner email fallback'
);
replaceExact(
  'src/server/setup/review-setup.gs',
  /var url = 'https:\/\/script\.google\.com\/macros\/s\/[^']+';/g,
  "var url = 'YOUR_WEB_APP_URL';",
  'deployment URL'
);
replaceExact(
  'src/server/setup/review-setup.gs',
  /\['web_app_url', '[^']+', 'Updated after Web App deployment\.'\]/g,
  "['web_app_url', 'YOUR_WEB_APP_URL', 'Updated after Web App deployment.']",
  'config Web App URL'
);
replaceExact(
  'src/server/maintenance/rollback-and-self-test.gs',
  /SpreadsheetApp\.openById\('[^']+'\)/g,
  "SpreadsheetApp.openById('YOUR_BASELINE_SPREADSHEET_ID')",
  'rollback baseline spreadsheet ID'
);
replaceExact(
  'src/ui/client/review-app.js',
  /contextProcessingConversationUrl: "[^"]+"/g,
  'contextProcessingConversationUrl: "https://chatgpt.com/"',
  'demo context conversation URL'
);
replaceExact(
  'prompts/daily-task.txt',
  /^- Spreadsheet ID：.+$/gm,
  '- Spreadsheet ID：YOUR_SPREADSHEET_ID',
  'daily prompt spreadsheet ID'
);
replaceExact(
  'prompts/daily-task.txt',
  /^- Web App：.+$/gm,
  '- Web App：YOUR_WEB_APP_URL',
  'daily prompt Web App URL'
);
replaceExact(
  'prompts/daily-task.txt',
  /“个性化素材已暂存。请返回答题网页，系统会去重、写入候选池并继续准备题组：[^”]+”/g,
  '“个性化素材已暂存。请返回答题网页，系统会去重、写入候选池并继续准备题组：YOUR_WEB_APP_URL”',
  'candidate completion URL'
);
replaceExact(
  'prompts/daily-task.txt',
  /“题目暂存段已准备好。请返回答题网页检查完整题组；若仍有缺失，网页会继续提供下一段完整提示词：[^”]+”/g,
  '“题目暂存段已准备好。请返回答题网页检查完整题组；若仍有缺失，网页会继续提供下一段完整提示词：YOUR_WEB_APP_URL”',
  'question completion URL'
);
replaceExact(
  'prompts/daily-task.txt',
  /“批改暂存段已完成。请返回答题页面；全部已提交题目覆盖后，系统才会统一核验、写入并显示结果。若仍有缺失，网页会继续提供下一段完整提示词：[^”]+”/g,
  '“批改暂存段已完成。请返回答题页面；全部已提交题目覆盖后，系统才会统一核验、写入并显示结果。若仍有缺失，网页会继续提供下一段完整提示词：YOUR_WEB_APP_URL”',
  'grading completion URL'
);
replaceExact(
  'prompts/context-processing.txt',
  /^- Spreadsheet ID：.+$/gm,
  '- Spreadsheet ID：YOUR_SPREADSHEET_ID',
  'context prompt spreadsheet ID'
);
replaceExact(
  'prompts/context-processing.txt',
  /^- 语料箱：.+$/gm,
  '- 语料箱：YOUR_WEB_APP_URL',
  'context prompt intake URL'
);
replaceExact(
  'prompts/context-processing.txt',
  /“语料整理暂存已完成。请返回语料箱确认要加入候选池的表达：[^”]+”/g,
  '“语料整理暂存已完成。请返回语料箱确认要加入候选池的表达：YOUR_WEB_APP_URL”',
  'context completion URL'
);

console.log(`Public export created at ${target}`);

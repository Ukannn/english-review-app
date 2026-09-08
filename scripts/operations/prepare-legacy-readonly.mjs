import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const readers = new Set(['getLearningDashboardV4', 'getLearningAnalyticsV4', 'getPhraseLibraryV4', 'getPhraseDetailV4', 'getSystemStatusV4']);
const managedTriggers = new Set(['scheduledBuildDailyQueue', 'scheduledBuildDailyQueueV4', 'processPendingGradeInboxV4']);
const digest = text => crypto.createHash('sha256').update(text).digest('hex');

export function guardSource(source, names) {
  return source.replace(/^function ([A-Za-z_$][\w$]*)\(([^)]*)\)\s*\{/gm, (opening, name) => {
    if (name === 'assertV4Enabled_') return opening + '\n  return; // This release exposes guarded readonly readers; older releases still honor ER4_ENABLED.\n';
    if (name.endsWith('_') || readers.has(name)) return opening;
    names.push(name);
    if (name === 'doGet') return opening + '\n  return englishLegacyReadOnlyPage_();\n';
    if (managedTriggers.has(name)) return opening + '\n  return disableLegacyEnglishTriggersForCutover();\n';
    return opening + '\n  throw new Error("ENGLISH_LEGACY_READ_ONLY: 请前往新的英语学习网站；旧记录仅供查阅。");\n';
  });
}

export function prepare({ source, target, siteUrl, sheetUrl }) {
  source = path.resolve(source); target = path.resolve(target);
  if (target === source || target.startsWith(source + path.sep)) throw new Error('Use a separate empty output directory.');
  if (!/^https:\/\/[a-z0-9.-]+\.pages\.dev\/?$/.test(siteUrl)) throw new Error('A verified Pages URL is required.');
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(sheetUrl)) throw new Error('A verified workbook URL is required.');
  const files = fs.readdirSync(source).filter(name => /\.(js|gs|html|json)$/.test(name));
  for (const required of ['ReviewWebAppV4.js', 'ReviewApp.html', 'appsscript.json']) {
    if (!files.includes(required)) throw new Error('Fresh Apps Script snapshot is incomplete: ' + required);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'appsscript.json'), 'utf8'));
  if (manifest.webapp?.access !== 'MYSELF') throw new Error('Unexpected legacy access; inspect before preparing cutover.');
  fs.mkdirSync(target, {recursive:true});
  if (fs.readdirSync(target).length) throw new Error('Output directory must be empty.');
  const report = {sourceHashes:{}, outputHashes:{}, blockedEntrypoints:[], readOnlyEntrypoints:[...readers]};
  for (const name of files) {
    let text = fs.readFileSync(path.join(source, name), 'utf8');
    report.sourceHashes[name] = digest(text);
    if (/\.(js|gs)$/.test(name)) text = guardSource(text, report.blockedEntrypoints);
    if (name === 'ReviewWebAppV4.js') {
      const html = `<!doctype html><html lang="zh-CN"><head><base target="_top"><style>body{font:16px system-ui;margin:32px auto;max-width:900px;padding:20px;color:#193e3a;background:#f7faf8}a,button{color:#12675e}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}button{padding:10px}#status{white-space:pre-wrap}</style></head><body><h1>英语历史记录 · 只读</h1><p>英语学习已切换到独立网站。这里保留原有统计和词库；作答、批改、语料录入和自动建队列已停用。</p><p><a href="${siteUrl}">打开新的英语学习网站</a> · <a href="${sheetUrl}">查阅原始工作簿</a></p><button id="load">查看历史词库</button><p id="status"></p><table><thead><tr><th>表达</th><th>含义</th><th>状态</th></tr></thead><tbody id="rows"></tbody></table><script>var offset=0;document.getElementById('load').onclick=function(){var button=this;button.disabled=true;google.script.run.withFailureHandler(function(e){document.getElementById('status').textContent=e.message;button.disabled=false}).withSuccessHandler(function(r){r.phrases.forEach(function(p){var tr=document.createElement('tr');[p.chunk,p.chineseCue,p.status].forEach(function(v){var td=document.createElement('td');td.textContent=v||'';tr.appendChild(td)});document.getElementById('rows').appendChild(tr)});offset+=r.phrases.length;button.disabled=!r.hasMore;button.textContent=r.hasMore?'加载更多':'已加载全部';document.getElementById('status').textContent='已显示 '+offset+' / '+r.filteredTotal}).getPhraseLibraryV4({offset:offset,limit:100})};</script></body></html>`;
      text += '\nfunction englishLegacyReadOnlyPage_() {\n  return HtmlService.createHtmlOutput(' + JSON.stringify(html) + ').setTitle("英语历史记录 · 只读").addMetaTag("viewport", "width=device-width, initial-scale=1");\n}\n';
      text += `
function disableLegacyEnglishTriggersForCutover() {
  assertAuthorizedV4_();
  PropertiesService.getScriptProperties().setProperty(ER4.enabledProperty, 'no');
  var managed = ['scheduledBuildDailyQueue', 'scheduledBuildDailyQueueV4', 'processPendingGradeInboxV4'];
  var removed = [];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var handler = t.getHandlerFunction();
    if (managed.indexOf(handler) !== -1) { ScriptApp.deleteTrigger(t); removed.push(handler); }
  });
  return {readOnly:true, removed:removed, remaining:ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction()})};
}
`;
    }
    fs.writeFileSync(path.join(target, name), text, {mode:0o600});
    report.outputHashes[name] = digest(text);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  if (['--source','--target','--site-url','--sheet-url'].some(name => !args.includes(name))) {
    throw new Error('Usage: --source <fresh-pull> --target <empty-dir> --site-url <verified-URL> --sheet-url <verified-URL>');
  }
  const result = prepare({source:option('--source'),target:option('--target'),siteUrl:option('--site-url'),sheetUrl:option('--sheet-url')});
  console.log(JSON.stringify(result,null,2));
}

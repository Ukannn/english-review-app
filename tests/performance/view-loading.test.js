const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'dist', 'ReviewApp.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'dist', 'ReviewWebAppV4.js'), 'utf8');

const doGet = backend.slice(backend.indexOf('function doGet('), backend.indexOf('function setupReviewWebAppV4'));
assert.doesNotMatch(doGet, /SpreadsheetApp|ensure[A-Z]|assertContractV4_/,
  'the HTML shell must not read or migrate Sheets');

const bootstrap = backend.slice(
  backend.indexOf('function getReviewBootstrapV4('),
  backend.indexOf('function validatePreparedQuestionBatchV4_')
);
assert.doesNotMatch(bootstrap, /ensureDynamicQuestionCountSchemaV4_/,
  'review bootstrap must not run schema setup');
assert.match(bootstrap, /canUseExisting[\s\S]*\['presented', 'committed'\]/,
  'review bootstrap must fast-path an existing active queue');

for (const endpoint of ['getLearningAnalyticsV4', 'getPhraseLibraryV4', 'getSystemStatusV4']) {
  assert.match(backend, new RegExp(`function ${endpoint}\\(`), `${endpoint} must exist`);
}
assert.match(backend, /function getPhraseLibraryV4[\s\S]*limit = Math\.min\(100[\s\S]*hasMore:/,
  'phrase library must use bounded server pagination');

const contextGet = backend.slice(
  backend.indexOf('function getContextInboxV4('),
  backend.indexOf('function contextDerivedStatusV4_')
);
assert.doesNotMatch(contextGet, /LockService|reconcileContextStatusesV4_|SpreadsheetApp\.flush/,
  'context inbox GET must be lock-free and read-only');
assert.match(contextGet, /allItems\.slice\(0, limit\)/,
  'context inbox payload must be bounded');

const activateView = html.slice(html.indexOf('function activateView('), html.indexOf('function loadContextInbox('));
assert.match(activateView, /loadAnalytics\(\)/);
assert.match(activateView, /loadPhraseLibrary\(false\)/);
assert.match(activateView, /loadSystemStatus\(\)/);
assert.doesNotMatch(activateView, /callServer\("getLearningDashboardV4"/,
  'views must not load the combined dashboard endpoint');

console.log('view loading performance contract: PASS');

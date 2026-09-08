const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('cutover guard blocks legacy writers and auto queue bootstrap, including future public entrypoints', async () => {
  const {guardSource} = await import('../../scripts/operations/prepare-legacy-readonly.mjs');
  const names=[];
  const guarded=guardSource('function saveDraftV4() { mutated = true; }\nfunction getReviewBootstrapV4() { mutated = true; }\nfunction futureWriter() { mutated = true; }\nfunction helper_() { return 4; }\nfunction getPhraseLibraryV4() { return [1]; }', names);
  const context={mutated:false}; vm.createContext(context); vm.runInContext(guarded,context);
  for (const name of ['saveDraftV4','getReviewBootstrapV4','futureWriter']) assert.throws(()=>context[name](),/ENGLISH_LEGACY_READ_ONLY/);
  assert.equal(context.mutated,false); assert.equal(context.helper_(),4);
  assert.equal(context.getPhraseLibraryV4()[0],1);
});

test('existing scheduled handlers retire their own English triggers without touching workbook data', async () => {
  const {guardSource} = await import('../../scripts/operations/prepare-legacy-readonly.mjs');
  const names=['scheduledBuildDailyQueue','scheduledBuildDailyQueueV4','processPendingGradeInboxV4'];
  const context={mutated:false,retired:0};
  vm.createContext(context);
  context.disableLegacyEnglishTriggersForCutover=()=>{context.retired++;return {readOnly:true};};
  vm.runInContext(guardSource(names.map(name=>`function ${name}() { mutated = true; }`).join('\n'),[]),context);
  for(const name of names)assert.equal(context[name]().readOnly,true);
  assert.equal(context.retired,3);assert.equal(context.mutated,false);
});

test('readonly release can read history while the shared flag blocks cached older writers', async () => {
  const {guardSource} = await import('../../scripts/operations/prepare-legacy-readonly.mjs');
  const source='function assertV4Enabled_() { throw new Error("disabled"); }\nfunction getPhraseLibraryV4() { assertV4Enabled_(); return 87; }\nfunction saveDraftV4() { assertV4Enabled_(); mutated = true; }';
  const context={mutated:false};vm.createContext(context);vm.runInContext(guardSource(source,[]),context);
  assert.equal(context.getPhraseLibraryV4(),87);assert.throws(()=>context.saveDraftV4(),/ENGLISH_LEGACY_READ_ONLY/);assert.equal(context.mutated,false);
});

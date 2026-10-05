const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('management migration envelopes accept both source formats and preserve exact history',async()=>{
  const {migrationEnvelope,assertMigrationReadback}=await import('../../scripts/operations/apply-migrations-management.mjs');
  for(const source of ['begin;\nselect 1;\ncommit;\n','-- CLI migration without a transaction wrapper\nselect 1;\n']){
    const row=migrationEnvelope('20261005090000_test.sql',source);
    assert.ok(row.readbackQuery.includes(source));assert.ok(row.query.includes('select 1;'));
    assert.equal(assertMigrationReadback({rows:[{result:{version:row.version,name:row.name,sourceMatches:true}}]},row).sourceMatches,true);
    assert.throws(()=>assertMigrationReadback({rows:[{result:{sourceMatches:false}}]},row),/mismatch/);
  }
  assert.throws(()=>migrationEnvelope('20261005090000_test.sql','begin;\nselect 1;'),/Incomplete/);
  assert.throws(()=>migrationEnvelope('20261005090000_test.sql','select 1;\ncommit;'),/Incomplete/);
  assert.throws(()=>migrationEnvelope('20261005090000_test 2.sql','select 1;'),/filename/);
});
test('all canonical migrations can be prepared without a database',async()=>{
  const {prepare}=await import('../../scripts/operations/apply-migrations-management.mjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'english-management-test-'));
  try{
    const rows=prepare({directory});
    assert.equal(rows.length,fs.readdirSync(path.join(__dirname,'../../supabase/migrations')).filter(f=>f.endsWith('.sql')).length);
    assert.ok(rows.some(row=>row.name==='discard_unprocessed_context'));
    assert.ok(rows.some(row=>row.name==='append_reprocessed_context_candidates'));
    for(const row of rows)assert.ok(fs.statSync(row.file).size>0&&fs.statSync(row.readbackFile).size>0);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

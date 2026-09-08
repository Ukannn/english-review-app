import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const target=path.join(root,'output/cutover/preview-db-checks');
fs.mkdirSync(target,{recursive:true,mode:0o700});
const files=fs.readdirSync(path.join(root,'supabase/tests')).filter(name=>name.endsWith('.sql')).sort();
for(const name of files) {
  const original=fs.readFileSync(path.join(root,'supabase/tests',name),'utf8');
  const sql=original.replace(/^\\set ON_ERROR_STOP on\r?\n/m,'').trim();
  if(!/^begin;\s/i.test(sql)||! /\srollback;$/i.test(sql))throw new Error('Preview check must be a rolled-back test: '+name);
  const body=sql.replace(/^begin;\s*/i,'').replace(/\s*rollback;$/i,'');
  const delimiter='$test_'+crypto.createHash('sha256').update(body).digest('hex').slice(0,20)+'$';
  if(body.includes(delimiter))throw new Error('SQL delimiter collision');
  const query=`do $english_preview$ begin
 begin
  execute ${delimiter}${body}${delimiter};
  raise exception using errcode='PT019',message='ENGLISH_PREVIEW_TEST_ROLLBACK';
 exception when sqlstate 'PT019' then
  if sqlerrm <> 'ENGLISH_PREVIEW_TEST_ROLLBACK' then raise; end if;
 end;
end $english_preview$;\n`;
  fs.writeFileSync(path.join(target,name),query,{mode:0o600});
}
console.log(JSON.stringify({target,files,behavior:'Assertions fail normally; successful fixtures roll back inside one Management API statement.'}));

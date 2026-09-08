import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const literal=value=>{const delimiter='$english_'+hash(value).slice(0,20)+'$';if(value.includes(delimiter))throw new Error('SQL delimiter collision');return delimiter+value+delimiter;};

export function migrationEnvelope(filename,source) {
  const match=/^(\d{14})_([a-z0-9_]+)\.sql$/.exec(filename);
  if(!match)throw new Error('Unsupported English migration filename');
  // These versioned English files each own one outer transaction. Keep their body unchanged.
  const content=source.trim();
  if(!/^begin;\s/i.test(content)||! /\scommit;$/i.test(content))throw new Error('Expected a single outer BEGIN/COMMIT migration');
  const body=content.replace(/^begin;\s*/i,'').replace(/\s*commit;$/i,'');
  const [version,name]=match.slice(1), sourceSql=literal(source), bodySql=literal(body);
  return {version,name,sha256:hash(source),query:`do $english_apply$ begin
 perform set_config('lock_timeout','4s',true);
 perform pg_advisory_xact_lock(hashtextextended('english_versioned_migrations',0));
 execute 'create schema if not exists supabase_migrations';
 execute 'create table if not exists supabase_migrations.schema_migrations(version text not null primary key)';
 execute 'alter table supabase_migrations.schema_migrations add column if not exists statements text[]';
 execute 'alter table supabase_migrations.schema_migrations add column if not exists name text';
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}') then
  if not exists(select 1 from supabase_migrations.schema_migrations where version='${version}' and name='${name}' and statements=array[${sourceSql}]) then
   raise exception 'ENGLISH_MIGRATION_HISTORY_MISMATCH';
  end if;
  return;
 end if;
 execute ${bodySql};
 insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[${sourceSql}]);
end $english_apply$;
`,readbackQuery:`select jsonb_build_object('version',version,'name',name,'sourceMatches',statements=array[${sourceSql}]) as result
from supabase_migrations.schema_migrations where version='${version}';
`};
}

function cli(args,{expectResult=true}={}) {
 const result=spawnSync(process.env.SUPABASE_BIN||'supabase',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 if(result.error||result.status!==0)throw new Error('Supabase command did not confirm success. Re-read migration history before retrying; raw errors are not printed.');
 return expectResult?JSON.parse(result.stdout):undefined;
}

export function assertMigrationReadback(response,migration) {
 const result=response?.rows?.[0]?.result;
 if(response?.rows?.length!==1||result?.sourceMatches!==true||result.version!==migration.version||result.name!==migration.name)
  throw new Error('Migration readback mismatch; stop and inspect history');
 return {version:migration.version,name:migration.name,sha256:migration.sha256,sourceMatches:true};
}

export function prepare({directory=path.join(root,'output/cutover/management-migrations')}={}) {
 directory=path.resolve(directory);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort().map(filename=>{
  const row=migrationEnvelope(filename,fs.readFileSync(path.join(root,'supabase/migrations',filename),'utf8'));
  const file=path.join(directory,filename),readbackFile=path.join(directory,filename.replace(/\.sql$/,'.readback.sql'));
  fs.writeFileSync(file,row.query,{mode:0o600});fs.writeFileSync(readbackFile,row.readbackQuery,{mode:0o600});
  const {query,readbackQuery,...meta}=row;return {...meta,file,readbackFile};
 });
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({migrations},null,2)+'\n',{mode:0o600});
 return migrations;
}

export function apply({projectRef,directory}) {
 if(!/^[a-z]{20}$/.test(projectRef||''))throw new Error('Explicit English project ref required');
 const projects=cli(['projects','list','--output','json']);
 if(!Array.isArray(projects)||!projects.some(p=>p.id===projectRef&&p.name==='English Learning Lab'))throw new Error('Refusing target other than English Learning Lab');
 const migrations=prepare({directory}), receipts=[];
 for(const migration of migrations) {
  // A single DO is one Management API prepared statement and one implicit transaction.
  // Its successful empty/command output is not treated as a JSON result or readback.
  cli(['db','query','--linked','--project-ref',projectRef,'--file',migration.file,'--output','json'],{expectResult:false});
  const response=cli(['db','query','--linked','--project-ref',projectRef,'--file',migration.readbackFile,'--output','json']);
  receipts.push(assertMigrationReadback(response,migration));
  fs.writeFileSync(path.join(path.dirname(migration.file),'applied.json'),JSON.stringify({projectRef,checkedAt:new Date().toISOString(),receipts},null,2)+'\n',{mode:0o600});
 }
 return {projectRef,migrations:receipts};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const args=process.argv.slice(2),value=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 const directory=value('--output-dir');
 const result=args.includes('--apply')?apply({projectRef:value('--project-ref'),directory}):{prepared:true,migrations:prepare({directory})};
 console.log(JSON.stringify(result));
}

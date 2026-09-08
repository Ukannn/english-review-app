import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const magic=Buffer.from('ENGLISHBACKUP1\n');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

export function seal(payload,key) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(magic);
  const ciphertext=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),cipher.final()]);
  return Buffer.concat([magic,iv,cipher.getAuthTag(),ciphertext]);
}

export function unseal(bytes,key) {
  if(!bytes.subarray(0,magic.length).equals(magic))throw new Error('Not an English backup.');
  const start=magic.length, decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(start,start+12));
  decipher.setAAD(magic); decipher.setAuthTag(bytes.subarray(start+12,start+28));
  const result=JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(start+28)),decipher.final()])).toString());
  for(const [name,value] of Object.entries(result.files))if(hash(value)!==result.manifest.files[name])throw new Error('Backup file hash mismatch.');
  return result;
}

function run(args) {
  const result=spawnSync(process.env.SUPABASE_BIN||'supabase',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
  if(result.error||result.status!==0)throw new Error('Supabase backup command failed; no backup was published. Check CLI login and Docker, then retry.');
  return result.stdout;
}

export function backup({projectRef,local=false,destination,keyFile}) {
  if(!local) {
    if(!/^[a-z]{20}$/.test(projectRef||''))throw new Error('An explicit English project ref is required.');
    const projects=JSON.parse(run(['projects','list','-o','json']));
    const project=projects.find(item=>item.id===projectRef);
    if(!project||project.name!=='English Learning Lab')throw new Error('Refusing backup: target is not English Learning Lab.');
  }
  const targetArgs=local?['--local']:['--project-ref',projectRef];
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  fs.mkdirSync(path.dirname(keyFile),{recursive:true,mode:0o700});
  if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
  if((fs.statSync(keyFile).mode&0o077)!==0)throw new Error('Backup key must be accessible only to its owner.');
  const key=fs.readFileSync(keyFile);
  if(key.length!==32)throw new Error('Invalid backup key.');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'english-backup-')); fs.chmodSync(scratch,0o700);
  try {
    const files={};
    for(const [name,flags] of [
      ['schema.sql',['--schema','auth,extensions,english_private,english_api']],
      ['data.sql',['--data-only','--use-copy','--schema','english_private,auth']],
    ]) {
      const output=path.join(scratch,name);
      run(['db','dump',...targetArgs,...flags,'--file',output]);
      files[name]=fs.readFileSync(output,'utf8');
    }
    for(const name of fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')))
      files['migrations/'+name]=fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
    files['config.toml']=fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
    const deployed=path.join(root,'output/cutover/deployment.json');
    if(!local&&fs.existsSync(deployed))files['deployment.json']=fs.readFileSync(deployed,'utf8');
    const manifest={format:1,projectRef:local?'local-english':projectRef,createdAt:new Date().toISOString(),
      scope:['english_private','english_api','auth data'],storageObjects:false,
      files:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,hash(value)]))};
    const payload={manifest,files}, encrypted=seal(payload,key);
    const restored=unseal(encrypted,key);
    if(JSON.stringify(restored)!==JSON.stringify(payload))throw new Error('Encryption roundtrip failed.');
    const filename='english-'+manifest.createdAt.replace(/[:.]/g,'-')+'.encrypted';
    const finalPath=path.join(destination,filename), partial=finalPath+'.partial';
    fs.writeFileSync(partial,encrypted,{mode:0o600,flag:'wx'});fs.renameSync(partial,finalPath);
    // Retention is by successful weekly generations. Never prune until the new encrypted file verifies.
    const previous=fs.readdirSync(destination).filter(name=>/^english-.*\.encrypted$/.test(name)).sort().reverse();
    const weeks=new Set();
    for(const name of previous) {
      const date=new Date(name.slice(8,18)+'T00:00:00Z');
      const week=Math.floor((date.getTime()+3*86400000)/(7*86400000));
      weeks.add(week);
      if(weeks.size>8)fs.unlinkSync(path.join(destination,name));
    }
    return {file:finalPath,encrypted:true,sha256:hash(encrypted),files:Object.keys(files).length,restoreDrill:'required separately'};
  } finally {fs.rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
  const keyFile=get('--key-file')||path.join(os.homedir(),'.config/english-learning-lab/backup-key');
  if(args.includes('--extract')) {
    const target=get('--target');if(!target)throw new Error('--target is required.');
    fs.mkdirSync(target,{recursive:true,mode:0o700});if(fs.readdirSync(target).length)throw new Error('Restore output must be empty.');
    const result=unseal(fs.readFileSync(get('--extract')),fs.readFileSync(keyFile));
    for(const [name,contents] of Object.entries(result.files)) {
      if(path.isAbsolute(name)||name.split('/').includes('..'))throw new Error('Unsafe archive path.');
      const file=path.join(target,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,contents,{mode:0o600});
    }
    fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(result.manifest,null,2),{mode:0o600});
    console.log(JSON.stringify({extracted:true,files:Object.keys(result.files).length}));
  } else console.log(JSON.stringify(backup({projectRef:get('--project-ref'),local:args.includes('--local'),keyFile,
    destination:get('--destination')||path.join(os.homedir(),'Documents/英语学习备份')})));
}

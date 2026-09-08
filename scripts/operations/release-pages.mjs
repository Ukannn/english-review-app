import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertProductionSource} from './git-release-gate.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const environment=get('--environment'),projectRef=get('--project-ref');
if(!['preview','production'].includes(environment)||!/^[a-z]{20}$/.test(projectRef||''))
  throw new Error('Usage: --environment preview|production --project-ref <English ref> [--reconciliation <final report>]');
const projects=JSON.parse(execFileSync(process.env.SUPABASE_BIN||'supabase',['projects','list','-o','json'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(projects.find(item=>item.id===projectRef)?.name!=='English Learning Lab')throw new Error('The deployment target is not English Learning Lab.');
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!key||(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ')))throw new Error('Provide an English publishable key through the environment.');
if(key.startsWith('eyJ')) {
  const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
  if(claims.role!=='anon'||claims.ref!==projectRef)throw new Error('The legacy key must be this project’s anon key.');
}
if(environment==='production') {
  assertProductionSource(root);
  if(!get('--reconciliation'))throw new Error('Production requires the final remote reconciliation report.');
  const report=JSON.parse(fs.readFileSync(get('--reconciliation'),'utf8'));
  if(report.ok!==true||report.activeLegacyCount!==0||report.rawMismatchCount!==0||report.missingRawRows!==0||report.ownerRegistered!==true)
    throw new Error('Final reconciliation has not passed.');
  if(report.projectRef!==projectRef||report.sourceState!=='final_frozen'||!report.snapshotSha256||!report.checkedAt)
    throw new Error('Production requires this project’s remote readback of the final frozen snapshot.');
}
const env={...process.env,VITE_SUPABASE_URL:'https://'+projectRef+'.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:key,VITE_DEMO_MODE:'false'};
const built=spawnSync('npm',['--prefix','pwa','run','build'],{cwd:root,env,stdio:'inherit'});
if(built.status!==0)throw new Error('Build failed.');
const dist=path.join(root,'pwa/dist');
if(fs.existsSync(path.join(dist,'_worker.js'))||fs.existsSync(path.join(root,'functions')))throw new Error('This release must contain static assets only.');
const receipt={project:'english-learning-lab',projectRef,environment,builtAt:new Date().toISOString(),
  commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  workingTreeModified:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())};
fs.writeFileSync(path.join(dist,'build-info.json'),JSON.stringify(receipt));
const deployed=spawnSync('npx',['--yes','wrangler@4.129.1','pages','deploy','pwa/dist','--project-name','english-learning-lab',
  '--branch',environment==='production'?'main':'preview','--commit-dirty=true'],{cwd:root,env,stdio:'inherit'});
if(deployed.status!==0)throw new Error('Deployment did not confirm success. Read back Pages before retrying.');
fs.mkdirSync(path.join(root,'output/cutover'),{recursive:true});
fs.writeFileSync(path.join(root,'output/cutover',environment+'-build.json'),JSON.stringify(receipt,null,2));
console.log('Build deployed. Verify the actual Pages URL, build-info.json and login before marking release complete.');

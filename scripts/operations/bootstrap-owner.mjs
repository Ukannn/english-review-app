import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const projectRef=get('--project-ref'),email=get('--email')?.trim().toLowerCase();
if(!/^[a-z]{20}$/.test(projectRef||'')||!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Provide --project-ref and --email for the new English owner.');
const cli=process.env.SUPABASE_BIN||'supabase';
function cliJson(command) {
  try {return JSON.parse(execFileSync(cli,command,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
  catch {throw new Error('Supabase CLI authentication/read failed. No credentials are printed.');}
}
const projects=cliJson(['projects','list','-o','json']);
if(projects.find(item=>item.id===projectRef)?.name!=='English Learning Lab')throw new Error('Refusing to provision an owner outside English Learning Lab.');
const keys=cliJson(['projects','api-keys','--project-ref',projectRef,'--reveal','-o','json']);
const key=keys.find(item=>item.name==='service_role')?.api_key||keys.find(item=>item.type==='secret')?.api_key;
if(!key)throw new Error('No admin API key available through the existing CLI authorization.');
async function request(route,method='GET',body) {
  const response=await fetch('https://'+projectRef+'.supabase.co/auth/v1/admin/'+route,{
    method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,
  });
  if(!response.ok)throw new Error('English Auth admin request failed (HTTP '+response.status+').');
  return response.json();
}
async function findOwner() {
  const result=await request('users?page=1&per_page=1000');
  const users=result.users||[];
  if(users.some(user=>user.email?.toLowerCase()!==email))throw new Error('Unexpected existing Auth identity; inspect before provisioning.');
  return users.find(user=>user.email?.toLowerCase()===email);
}
let owner=await findOwner(),created=false;
if(!owner) {
  try {owner=await request('users','POST',{email,email_confirm:true,user_metadata:{password_set:false}});created=true;}
  catch(error) {owner=await findOwner();if(!owner)throw error;}
}
if(!owner.id)throw new Error('Auth owner was not returned.');
console.log(JSON.stringify({ownerId:owner.id,created,passwordSetByAgent:false}));

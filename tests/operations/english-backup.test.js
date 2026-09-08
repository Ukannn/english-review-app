const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');

test('encrypted English backup authenticates the complete archive and detects tampering',async()=>{
  const {seal,unseal}=await import('../../scripts/operations/english-backup.mjs');
  const key=crypto.randomBytes(32),text='private learning history';
  const payload={manifest:{files:{'data.sql':crypto.createHash('sha256').update(text).digest('hex')}},files:{'data.sql':text}};
  const bytes=seal(payload,key);
  assert.equal(bytes.includes(Buffer.from(text)),false);
  assert.deepEqual(unseal(bytes,key),payload);
  const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
  assert.throws(()=>unseal(changed,key));assert.throws(()=>unseal(bytes,crypto.randomBytes(32)));
});

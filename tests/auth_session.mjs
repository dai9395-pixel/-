import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/auth.js',import.meta.url),'utf8');
const buttons=[];
globalThis.document={createElement(tag){assert.equal(tag,'button','Restored session must not show login');return {};},querySelector(){return {append(b){buttons.push(b)}}}};
let now=100000,refreshes=0,fail=false,calls=[];
Date.now=()=>now;
globalThis.fetch=async(path,options)=>{
 calls.push(path);
 if(path==='/runtime.json')return new Response(JSON.stringify({authentication:true}));
 if(path==='/api/auth/refresh'){
  refreshes++;
  if(fail)return new Response(JSON.stringify({error:'Temporary outage'}),{status:502});
  return new Response(JSON.stringify({access_token:'fake-access-'+refreshes,expires_in:3600}));
 }
 assert.match(options.headers.Authorization,/^Bearer fake-access-/);
 return new Response('[]');
};
const auth=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
await auth.initializeAuth();assert.equal(refreshes,1);
await auth.authorizedFetch('/api/staff');assert.equal(refreshes,1);
now+=3600000;await Promise.all([auth.authorizedFetch('/api/staff'),auth.authorizedFetch('/api/stores')]);assert.equal(refreshes,2);
now+=3600000;fail=true;await assert.rejects(auth.authorizedFetch('/api/staff'),/Temporary outage/);
fail=false;await auth.authorizedFetch('/api/staff');assert.equal(refreshes,4);
assert.equal(buttons.length,1);
console.log('PASS: startup restoration, proactive renewal, concurrent refresh deduplication, recovery after network failure');

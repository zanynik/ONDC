import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,diffieHellman,createCipheriv} from 'node:crypto';
import {signSubscriptionRequest,decryptRegistryChallenge,publicKeysFromPrivate} from '../worker/registration.ts';
import worker from '../dist/server/index.js';

test('verification signature signs the exact registry request ID',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const seed=privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
 const signature=signSubscriptionRequest('request-from-portal',seed);
 assert.equal(verify(null,Buffer.from('request-from-portal'),publicKey,Buffer.from(signature,'base64')),true);
 assert.equal(verify(null,Buffer.from('different-request'),publicKey,Buffer.from(signature,'base64')),false);
});
test('registry challenge supports DER and raw X25519 private keys',()=>{
 const participant=generateKeyPairSync('x25519'),registry=generateKeyPairSync('x25519');
 const shared=diffieHellman({privateKey:registry.privateKey,publicKey:participant.publicKey});
 const encrypt=createCipheriv('aes-256-ecb',shared,null);
 const challenge=Buffer.concat([encrypt.update('registry-challenge','utf8'),encrypt.final()]).toString('base64');
 const encoded=participant.privateKey.export({format:'der',type:'pkcs8'});
 const registryPublic=registry.publicKey.export({format:'der',type:'spki'}).toString('base64');
 for(const key of [encoded,encoded.subarray(-32)]) assert.equal(decryptRegistryChallenge(challenge,key.toString('base64'),registryPublic),'registry-challenge');
 assert.throws(()=>decryptRegistryChallenge('not-base64',encoded.toString('base64'),registryPublic));
});
test('unconfigured onboarding routes do not claim success or enable production',async()=>{
 const env={ONDC_DEPLOYMENT_MODE:'staging'};
 assert.equal((await worker.fetch(new Request('https://example.test/ondc-site-verification.html'),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://example.test/buyer/on_subscribe',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://example.test/buyer/on_subscribe'),env,{})).status,405);
 const health=await(await worker.fetch(new Request('https://example.test/buyer/health'),env,{})).json();assert.equal(health.production_ready,false);
});

test('operator key diagnostics derive matching public keys without exposing private material', async()=>{
 const signing=generateKeyPairSync('ed25519'), encryption=generateKeyPairSync('x25519');
 const seed=signing.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
 const secret=encryption.privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
 const expected={signing_public_key:signing.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'),encryption_public_key:encryption.publicKey.export({format:'der',type:'spki'}).toString('base64')};
 assert.deepEqual(publicKeysFromPrivate(seed,secret),expected);
 assert.deepEqual(publicKeysFromPrivate(seed,Buffer.from(secret,'base64').subarray(-32).toString('base64')),expected);
 const env={ONDC_WORKBENCH_TOKEN:'operator-token',ONDC_SIGNING_PRIVATE_KEY:seed,ONDC_ENCRYPTION_PRIVATE_KEY:secret};
 assert.equal((await worker.fetch(new Request('https://example.test/buyer/key-health'),env,{})).status,404);
 const res=await worker.fetch(new Request('https://example.test/buyer/key-health',{headers:{'x-ondc-admin-token':'operator-token'}}),env,{});
 const body=await res.text();assert.ok(!body.includes(seed));assert.ok(!body.includes(secret));
 assert.deepEqual(JSON.parse(body),{valid:true,unique_key_id:null,...expected,storage_connected:false});
 const invalid=await worker.fetch(new Request('https://example.test/buyer/key-health',{headers:{'x-ondc-admin-token':'operator-token'}}),{...env,ONDC_ENCRYPTION_PRIVATE_KEY:'bad'},{});
 assert.equal(invalid.status,503);assert.deepEqual(await invalid.json(),{valid:false,error:'key_configuration_invalid'});
});

test('registry lookup is operator-only, signs the exact fixed-destination request and ignores supplied URLs',async t=>{
 const signing=generateKeyPairSync('ed25519');
 const seed=signing.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
 const env={ONDC_WORKBENCH_TOKEN:'operator-token',ONDC_SIGNING_PRIVATE_KEY:seed,ONDC_SUBSCRIBER_ID:'buyer.example',ONDC_UNIQUE_KEY_ID:'key-1'};
 const request=(body,authorized=true)=>new Request('https://example.test/buyer/registry/lookup',{method:'POST',headers:{'content-type':'application/json',...(authorized?{'x-ondc-admin-token':'operator-token'}:{})},body:JSON.stringify(body)});
 assert.equal((await worker.fetch(request({},false),env,{})).status,404);
 assert.equal((await worker.fetch(request({subscriber_id:'https://attacker.example'}),env,{})).status,400);
 const prepared=await(await worker.fetch(request({dry_run:true}),env,{})).json();
 assert.equal(prepared.url,'https://preprod.registry.ondc.org/v2.0/lookup');
 assert.deepEqual(JSON.parse(prepared.body),{country:'IND',domain:'ONDC:RET10',subscriber_id:'buyer.example'});
 assert.ok(!JSON.stringify(prepared).includes(seed));
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;assert.equal(url,'https://preprod.registry.ondc.org/v2.0/lookup');assert.equal(options.redirect,'error');
  assert.deepEqual(JSON.parse(options.body),{country:'IND',domain:'ONDC:RET10',subscriber_id:'buyer.example'});
  const h=options.headers.authorization;
  const created=h.match(/created="(\d+)"/)[1],expires=h.match(/expires="(\d+)"/)[1],signature=h.match(/signature="([^"]+)"/)[1];
  const {blake2b}=await import('blakejs');const digest=Buffer.from(blake2b(Buffer.from(options.body),undefined,64)).toString('base64');
  assert.ok(verify(null,Buffer.from(`(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`),signing.publicKey,Buffer.from(signature,'base64')));
  return new Response(JSON.stringify([{subscriber_id:'buyer.example'}]),{headers:{'content-type':'application/json'}});
 });
 const res=await worker.fetch(request({url:'https://attacker.example'}),env,{});assert.equal(res.status,200);assert.equal(calls,1);
 assert.equal((await worker.fetch(request({}),{...env,ONDC_REGISTRY_ENVIRONMENT:'production'},{})).status,503);assert.equal(calls,1);
});

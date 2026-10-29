import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,diffieHellman,createCipheriv} from 'node:crypto';
import {signSubscriptionRequest,decryptRegistryChallenge} from '../worker/registration.ts';
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

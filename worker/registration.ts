import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, diffieHellman, createDecipheriv, sign } from 'node:crypto';

// ONDC's published registry keys; callers cannot supply an alternative registry key.
export const registryEncryptionKeys = {
  preproduction: 'MCowBQYDK2VuAyEARa/WcMCzNQp4DWjvTI4DK7vHL6EdaHqN4GjFIu9wxxM=',
  production: 'MCowBQYDK2VuAyEAwASk2D4O3p/tuD8f9sNQAQlwOU2w3DAumcOK9qHCFwI=',
};
function decode(value: string) {
  const bytes=Buffer.from(value,'base64');
  if (!value || bytes.toString('base64') !== value) throw new Error('invalid_key_or_challenge');
  return bytes;
}
export function signSubscriptionRequest(requestId: string, encodedPrivateKey: string): string {
  if (!requestId.trim() || requestId.length>512) throw new Error('invalid_request_id');
  const bytes=decode(encodedPrivateKey);
  const seed=bytes.length===64?bytes.subarray(0,32):bytes;
  if(seed.length!==32) throw new Error('invalid_signing_key');
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  return sign(null,Buffer.from(requestId,'utf8'),privateKey).toString('base64');
}
export function decryptRegistryChallenge(challenge: string, encodedPrivateKey: string, registryPublicKey: string): string {
  const bytes=decode(encodedPrivateKey);
  const keyBytes=bytes.length===32?Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),bytes]):bytes;
  const privateKey=createPrivateKey({key:keyBytes,format:'der',type:'pkcs8'});
  const publicKey=createPublicKey({key:decode(registryPublicKey),format:'der',type:'spki'});
  if(privateKey.asymmetricKeyType!=='x25519'||publicKey.asymmetricKeyType!=='x25519')throw new Error('invalid_encryption_key');
  const encrypted=decode(challenge);
  if(!encrypted.length||encrypted.length>8192||encrypted.length%16)throw new Error('invalid_challenge');
  const sharedKey=diffieHellman({privateKey,publicKey});
  const decipher=createDecipheriv('aes-256-ecb',sharedKey,null);
  const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);
  return new TextDecoder('utf-8',{fatal:true}).decode(plain);
}

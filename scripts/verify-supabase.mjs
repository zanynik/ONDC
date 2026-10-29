// Supply {url,token,publishableKey} on hidden stdin; credentials are never logged.
import assert from 'node:assert/strict';
const input = await new Promise((resolve, reject) => {
  let value=''; if(process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8'); process.stdin.on('data',chunk=>{
    value+=chunk;if(value.includes('\n')) { if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(value));}catch{reject(Error('Invalid configuration'));} }
  });
  process.stderr.write('Ready for verification configuration on hidden stdin.\n');
});
const {url,token,publishableKey,workerUrl}=input;
const invoke=(body,auth=token)=>fetch(url+'/functions/v1/protocol-store',{method:'POST',headers:{'content-type':'application/json',...(auth?{'x-zeroprofit-backend-token':auth}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
assert.equal((await invoke({operation:'ping'},null)).status,401);
assert.equal((await invoke({operation:'ping'},'x'.repeat(64))).status,401);
let r=await invoke({operation:'ping'});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).result.storage,'postgres');
const tx='verification-'+crypto.randomUUID();
const payload=JSON.stringify({context:{action:'on_init',transaction_id:tx,message_id:crypto.randomUUID()},message:{order:{id:'VERIFY-NOT-A-REAL-ORDER'}}});
for(const expected of [true,false]) {r=await invoke({operation:'store_callback',endpoint:'/buyer/on_init',payload});assert.equal(r.status,200);assert.equal((await r.json()).result,expected);}
r=await invoke({operation:'latest_order',transactionId:tx,actions:['on_init']});assert.equal(r.status,200);assert.equal((await r.json()).result.id,'VERIFY-NOT-A-REAL-ORDER');
r=await invoke({operation:'list_logs',transactionId:tx,limit:20});assert.equal(r.status,200);assert.equal((await r.json()).result.length,1);
const nonce=crypto.randomUUID();for(const expected of [true,false]){r=await invoke({operation:'consume_nonce',nonce,expires:Date.now()+120000});assert.equal(r.status,200);assert.equal((await r.json()).result,expected);}
for(const table of ['ondc_callbacks','ondc_protocol_logs','orders','settlement_records']) {r=await fetch(url+'/rest/v1/'+table+'?select=*',{headers:{apikey:publishableKey},signal:AbortSignal.timeout(20000)});assert.ok([200,401,403].includes(r.status));if(r.status===200)assert.deepEqual(await r.json(),[]);}
if(workerUrl){const health=await fetch(workerUrl+'/buyer/storage-health',{headers:{'x-zeroprofit-backend-token':token},signal:AbortSignal.timeout(20000)});assert.equal(health.status,200);assert.deepEqual(await health.json(),{storage_backend:'supabase',connected:true});}
console.log(JSON.stringify({passed:true,cloudflare_to_postgres: Boolean(workerUrl),checks:['gateway authentication','Postgres connectivity','atomic callback persistence','retry deduplication','latest order retrieval','audit log','nonce replay protection','anonymous data isolation'],verification_transaction:tx,nonce}));

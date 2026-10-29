import assert from 'node:assert/strict';
import test from 'node:test';
import {createHandler} from '../supabase/functions/protocol-store/handler.ts';
const token='t'.repeat(64);
const request=body=>new Request('https://edge.example',{method:'POST',headers:{'content-type':'application/json','x-zeroprofit-backend-token':token},body:JSON.stringify(body)});
test('gateway rejects missing and incorrect credentials before reading customer records',async()=>{
 let calls=0;
 const handler=createHandler({url:'https://db.example',secretKey:'server-only'},async()=>{calls++;return Response.json(false);});
 assert.equal((await handler(new Request('https://edge.example',{method:'POST'}))).status,401);assert.equal(calls,0);
 assert.equal((await handler(request({operation:'list_logs',transactionId:null}))).status,401);assert.equal(calls,1);
});
test('gateway exact transaction filter does not add literal quotes',async()=>{
 let seen;
 const handler=createHandler({url:'https://db.example',secretKey:'server-only'},async(url,options)=>{
  assert.equal(options.headers.apikey,'server-only');
  if(url.includes('/rpc/zp_verify_backend_token'))return Response.json(true);
  seen=new URL(url);
  return Response.json([{payload:JSON.stringify({message:{order:{id:'real-order'}}})}]);
 });
 const r=await handler(request({operation:'latest_order',transactionId:'tx-123',actions:['on_init']}));
 assert.equal(r.status,200);assert.equal((await r.json()).result.id,'real-order');
 assert.equal(seen.searchParams.get('transaction_id'),'eq.tx-123');
});
test('gateway limits operations and conceals privileged database failures',async()=>{
 const handler=createHandler({url:'https://db.example',secretKey:'server-only'},async url=>url.includes('zp_verify_backend_token')?Response.json(true):Response.json({secret:'not-for-client'},{status:500}));
 assert.equal((await handler(request({operation:'execute_sql',sql:'select 1'}))).status,400);
 const r=await handler(request({operation:'ping'}));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'storage_unavailable'});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, sign } from 'node:crypto';
import { blake2b } from 'blakejs';
import worker from '../dist/server/index.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0000_flimsy_lord_hawal.sql', '0001_loving_rawhide_kid.sql', '0002_callback_receipts.sql']) {
    sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  }
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        run() { const r = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
        first() { return sqlite.prepare(sql).get(...values) ?? null; },
        all() { return { results: sqlite.prepare(sql).all(...values) }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
function fixture(t, extra = {}) {
  const DB = database(); t.after(() => DB.sqlite.close());
  const env = { DB, ...extra };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const call = (path, options = {}) => worker.fetch(new Request('https://example.test' + path, options), env, ctx);
  return { DB, env, call };
}
const callback = (action = 'on_init', id = 'message-1') => ({
  context: { action, transaction_id: 'transaction-1', message_id: id },
  message: { order: { id: 'REAL-ORDER-987', provider: { id: 'provider-1' }, items: [{ id: 'item-1', quantity: { count: 2 } }], quote: { price: { value: '250.00' } } } },
});
const post = (payload, authorization) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(payload) });
function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = 'seller.example|key-1|ed25519';
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64');
  return { seed, trusted: JSON.stringify({ [keyId]: rawPublic }), header(body, created = Math.floor(Date.now() / 1000)) {
    const expires = created + 300;
    const digest = Buffer.from(blake2b(Buffer.from(body), undefined, 64)).toString('base64');
    const data = `(created): ${created}\n(expires): ${expires}\ndigest: BLAKE-512=${digest}`;
    const signature = sign(null, Buffer.from(data), privateKey).toString('base64');
    return `Signature keyId="${keyId}",algorithm="ed25519",created="${created}",expires="${expires}",headers="(created) (expires) digest",signature="${signature}"`;
  } };
}

test('migration deployment blocks signed outbound traffic and reports its limits', async t => {
  const { call } = fixture(t, { ONDC_DEPLOYMENT_MODE: 'staging', ONDC_CALLBACK_VERIFICATION: 'required' });
  for (const path of ['/buyer/search', '/buyer/workbench/confirm', '/buyer/workbench/form']) {
    assert.equal((await call(path, { method: 'POST' })).status, 503);
  }
  const health = await (await call('/buyer/health')).json();
  assert.equal(health.production_ready, false);
  assert.equal(health.deployment_mode, 'staging');
  assert.equal(health.status, 'waiting_for_private_keys');
});

test('apex redirect preserves path and query', async t => {
  const { env } = fixture(t);
  const response = await worker.fetch(new Request('https://zeroprofit.food/terms?from=home'), env, {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://www.zeroprofit.food/terms?from=home');
});

test('callback context, method and content type are checked before persistence', async t => {
  const { call, DB } = fixture(t);
  assert.equal((await call('/buyer/on_init')).status, 405);
  assert.equal((await call('/buyer/on_init', { method: 'POST', body: '{}' })).status, 415);
  for (const payload of [null, {}, { context: {} }, callback('on_confirm')]) {
    assert.equal((await call('/buyer/on_init', post(payload))).status, 400);
  }
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ondc_callbacks').get().n, 0);
});

test('callback payload limit also covers chunked bodies without Content-Length', async t => {
  const { call } = fixture(t);
  assert.equal((await call('/buyer/on_init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(4 * 1024 * 1024 + 1) })).status, 413);
});

test('strict callbacks reject unsigned, altered and expired messages; accept a pinned signer', async t => {
  const keys = signer();
  const { call } = fixture(t, { ONDC_CALLBACK_VERIFICATION: 'required', ONDC_TRUSTED_SIGNING_KEYS: keys.trusted });
  const payload = callback();
  assert.equal((await call('/buyer/on_init', post(payload))).status, 401);
  assert.equal((await call('/buyer/on_init', post(payload, keys.header(JSON.stringify(payload), Math.floor(Date.now() / 1000) - 1000)))).status, 401);
  const header = keys.header(JSON.stringify(payload));
  const altered = structuredClone(payload); altered.message.order.id = 'altered';
  assert.equal((await call('/buyer/on_init', post(altered, header))).status, 401);
  assert.equal((await call('/buyer/on_init', post(payload, signer().header(JSON.stringify(payload))))).status, 401);
  assert.equal((await call('/buyer/on_init', post(payload, header))).status, 200);
});

test('callback retry writes one callback and one audit record', async t => {
  const { call, DB } = fixture(t);
  for (let i = 0; i < 2; i++) {
    const response = await call('/buyer/on_init', post(callback()));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message.ack.status, 'ACK');
    assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ondc_callbacks').get().n, 1);
  }
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ondc_protocol_logs').get().n, 1);
});

test('database failure returns retryable failure instead of acknowledging lost data', async t => {
  const { call, env, DB } = fixture(t);
  env.DB = { ...DB, async batch() { throw Error('database unavailable'); } };
  assert.equal((await call('/buyer/on_init', post(callback()))).status, 503);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ondc_callbacks').get().n, 0);
});

test('admin endpoints reject missing and incorrect tokens', async t => {
  const { call } = fixture(t, { ONDC_WORKBENCH_TOKEN: 'unit-test-token' });
  assert.equal((await call('/buyer/observability/logs')).status, 404);
  assert.equal((await call('/buyer/workbench/confirm', { method: 'POST', headers: { 'x-ondc-admin-token': 'wrong' } })).status, 404);
});

test('Buyer Delivery confirm carries actual order ID from on_init into order_details', async t => {
  const keys = signer();
  const { call } = fixture(t, { ONDC_WORKBENCH_TOKEN: 'unit-test-token', ONDC_SIGNING_PRIVATE_KEY: keys.seed, ONDC_SUBSCRIBER_ID: 'buyer.example', ONDC_SUBSCRIBER_URL: 'https://buyer.example/buyer', ONDC_UNIQUE_KEY_ID: 'key-1' });
  await call('/buyer/on_select', post(callback('on_select', 'select-message')));
  await call('/buyer/on_init', post(callback()));
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    assert.match(url, /workbench\.ondc\.tech\/.*\/confirm$/);
    assert.match(options.headers.authorization, /^Signature /);
    return Response.json({ message: { ack: { status: 'ACK' } } });
  };
  try {
    const response = await call('/buyer/workbench/confirm', { method: 'POST', headers: { 'x-ondc-admin-token': 'unit-test-token', 'x-ondc-transaction-id': 'transaction-1', 'x-ondc-workbench-flow': 'buyer-delivery' } });
    assert.equal(response.status, 200);
    assert.equal(sent.message.order.id, 'REAL-ORDER-987');
    const details = sent.message.order.fulfillments[0].tags.find(t => t.code === 'order_details');
    assert.equal(details.list.find(t => t.code === 'id').value, 'REAL-ORDER-987');
  } finally { globalThis.fetch = originalFetch; }
});

test('Supabase callbacks use the private gateway and never silently fall back to D1', async t => {
  const { call, DB } = fixture(t, { ZP_PROTOCOL_STORAGE: 'supabase', SUPABASE_URL: 'https://database.example', ZP_PROTOCOL_STORE_TOKEN: 'backend-test-token' });
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    assert.equal(url,'https://database.example/functions/v1/protocol-store');
    assert.equal(options.headers['x-zeroprofit-backend-token'],'backend-test-token');
    sent=JSON.parse(options.body);
    return Response.json({ result: true });
  };
  try {
    assert.equal((await call('/buyer/on_init', post(callback()))).status,200);
    assert.equal(sent.operation,'store_callback');assert.equal(sent.endpoint,'/buyer/on_init');
    assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM ondc_callbacks').get().n,0);
    globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});
    assert.equal((await call('/buyer/on_init',post(callback()))).status,503);
  } finally { globalThis.fetch=originalFetch; }
});

test('private storage health checks connectivity without returning transaction data', async t => {
  const { call } = fixture(t, { ZP_PROTOCOL_STORAGE: 'supabase', SUPABASE_URL: 'https://database.example', ZP_PROTOCOL_STORE_TOKEN: 'backend-test-token' });
  assert.equal((await call('/buyer/storage-health')).status,404);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({result:[{payload:'private-transaction'}]});
  try {
    const response=await call('/buyer/storage-health',{headers:{'x-zeroprofit-backend-token':'backend-test-token'}});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{storage_backend:'supabase',connected:true});
  }finally{globalThis.fetch=originalFetch;}
});

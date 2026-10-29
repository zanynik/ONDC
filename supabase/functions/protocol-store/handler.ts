interface RuntimeEnv { url: string; secretKey: string }
type DbCall = (path: string, body?: unknown, method?: string) => Promise<unknown>;
const result = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
export function createHandler(env: RuntimeEnv, fetcher: typeof fetch = fetch) {
  const db: DbCall = async (path, body, method = 'POST') => {
    const response = await fetcher(`${env.url}/rest/v1/${path}`, {
      method, headers: { apikey: env.secretKey, 'content-type': 'application/json', prefer: 'return=minimal' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('database_operation_failed');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return result({ error: 'method_not_allowed' }, 405);
    const token = request.headers.get('x-zeroprofit-backend-token');
    if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return result({ error: 'unauthorized' }, 401);
    try {
      if (await db('rpc/zp_verify_backend_token', { p_token: token }) !== true) return result({ error: 'unauthorized' }, 401);
      if (!(request.headers.get('content-type') ?? '').includes('application/json')) return result({ error: 'json_required' }, 415);
      // Count actual bytes too: Content-Length alone does not cover chunked input.
      if (Number(request.headers.get('content-length')) > 10 * 1024 * 1024) return result({ error: 'payload_too_large' }, 413);
      const reader = request.body?.getReader();
      let bytes = 0, raw = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 10 * 1024 * 1024) { await reader.cancel(); return result({ error: 'payload_too_large' }, 413); }
            raw += decoder.decode(chunk.value, { stream: true });
          }
          raw += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      let input: Record<string, unknown>;
      try { input = JSON.parse(raw); } catch { return result({ error: 'invalid_json' }, 400); }
      if (!input || Array.isArray(input) || typeof input !== 'object') return result({ error: 'invalid_payload' }, 400);
      switch (input.operation) {
        case 'ping': {
          await db('ondc_callbacks?select=id&limit=1', undefined, 'GET');
          return result({ result: { storage: 'postgres', ready: true } });
        }
        case 'store_callback': {
          if (typeof input.endpoint !== 'string' || typeof input.payload !== 'string') return result({ error: 'invalid_payload' }, 400);
          return result({ result: await db('rpc/zp_store_callback', { p_endpoint: input.endpoint, p_payload: input.payload }) });
        }
        case 'consume_nonce': {
          if (typeof input.nonce !== 'string' || !Number.isSafeInteger(input.expires)) return result({ error: 'invalid_payload' }, 400);
          return result({ result: await db('rpc/zp_consume_nonce', { p_nonce: input.nonce, p_expires: input.expires }) });
        }
        case 'latest_order': {
          if (typeof input.transactionId !== 'string' || !Array.isArray(input.actions) || !input.actions.length || input.actions.length > 8 || input.actions.some(x => typeof x !== 'string' || !/^[a-z_]{1,40}$/.test(x))) return result({ error: 'invalid_payload' }, 400);
          // URLSearchParams encodes the complete value, keeping it in one exact filter.
          const query = new URLSearchParams({ select: 'payload', transaction_id: 'eq.' + input.transactionId, action: 'in.(' + input.actions.join(',') + ')', order: 'id.desc', limit: '1' });
          const rows = await db('ondc_callbacks?' + query, undefined, 'GET') as Array<{ payload: string }>;
          return result({ result: rows.length ? JSON.parse(rows[0].payload)?.message?.order ?? null : null });
        }
        case 'list_logs': {
          if (input.transactionId !== null && typeof input.transactionId !== 'string') return result({ error: 'invalid_payload' }, 400);
          const limit = Math.min(1000, Math.max(1, Number(input.limit) || 250));
          const query = new URLSearchParams({ select: '*', order: input.transactionId ? 'id.asc' : 'id.desc', limit: String(Math.floor(limit)) });
          if (input.transactionId) query.set('transaction_id', 'eq.' + input.transactionId);
          return result({ result: await db('ondc_protocol_logs?' + query, undefined, 'GET') });
        }
        case 'write_log': {
          const log = input.log as Record<string, unknown> | undefined;
          if (!log || !['INBOUND','OUTBOUND'].includes(String(log.direction)) || typeof log.action !== 'string' || typeof log.endpoint !== 'string' || typeof log.payload !== 'string' || !Number.isSafeInteger(log.createdAt)) return result({ error: 'invalid_payload' }, 400);
          await db('ondc_protocol_logs', { direction: log.direction, action: log.action, transaction_id: log.transactionId, message_id: log.messageId, endpoint: log.endpoint, status_code: log.statusCode, created_at: log.createdAt, payload: log.payload });
          return result({ result: true });
        }
        default: return result({ error: 'unsupported_operation' }, 400);
      }
    } catch {
      // Never include a raw DB error, token or payload in a public response/log.
      return result({ error: 'storage_unavailable' }, 503);
    }
  };
}

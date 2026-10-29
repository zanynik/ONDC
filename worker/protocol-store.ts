/** Typed persistence boundary: Sites/D1 compatibility and Supabase backend. */
export interface ProtocolLog {
  direction: 'INBOUND' | 'OUTBOUND'; action: string; transactionId: string | null;
  messageId: string | null; endpoint: string; statusCode: number | null;
  createdAt: number; payload: string;
}
export interface StoreEnv {
  DB?: D1Database;
  SUPABASE_URL?: string;
  ZP_PROTOCOL_STORE_TOKEN?: string;
  ZP_PROTOCOL_STORAGE?: string;
}
export interface ProtocolStore {
  writeLog(log: ProtocolLog): Promise<void>;
  latestOrder(transactionId: string, actions: string[]): Promise<Record<string, unknown> | null>;
  listLogs(transactionId: string | null, limit: number): Promise<Record<string, unknown>[]>;
  consumeNonce(nonce: string, expires: number): Promise<boolean>;
  storeCallback(endpoint: string, payload: string): Promise<void>;
}
export function protocolStore(env: StoreEnv): ProtocolStore {
  if (env.ZP_PROTOCOL_STORAGE === 'supabase') return new SupabaseStore(env);
  if (!env.DB) throw new Error('Protocol storage is not configured');
  return new D1Store(env.DB);
}
class SupabaseStore implements ProtocolStore {
  constructor(private env: StoreEnv) {}
  async call<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    if (!this.env.SUPABASE_URL || !this.env.ZP_PROTOCOL_STORE_TOKEN) throw new Error('Supabase protocol storage is not configured');
    const response = await fetch(`${this.env.SUPABASE_URL}/functions/v1/protocol-store`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeroprofit-backend-token': this.env.ZP_PROTOCOL_STORE_TOKEN },
      body: JSON.stringify({ operation, ...args }), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`Protocol storage failed (${response.status})`);
    return (await response.json() as { result: T }).result;
  }
  async writeLog(log: ProtocolLog) { await this.call('write_log', { log }); }
  latestOrder(transactionId: string, actions: string[]) { return this.call<Record<string, unknown> | null>('latest_order', { transactionId, actions }); }
  listLogs(transactionId: string | null, limit: number) { return this.call<Record<string, unknown>[]>('list_logs', { transactionId, limit }); }
  consumeNonce(nonce: string, expires: number) { return this.call<boolean>('consume_nonce', { nonce, expires }); }
  async storeCallback(endpoint: string, payload: string) { await this.call('store_callback', { endpoint, payload }); }
}
class D1Store implements ProtocolStore {
  constructor(private db: D1Database) {}
  async writeLog(log: ProtocolLog) {
    await this.db.prepare('INSERT INTO ondc_protocol_logs (direction, action, transaction_id, message_id, endpoint, status_code, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(log.direction, log.action, log.transactionId, log.messageId, log.endpoint, log.statusCode, log.createdAt, log.payload).run();
  }
  async latestOrder(transactionId: string, actions: string[]) {
    const row = await this.db.prepare(`SELECT payload FROM ondc_callbacks WHERE transaction_id = ? AND action IN (${actions.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`)
      .bind(transactionId, ...actions).first<{ payload: string }>();
    if (!row) return null;
    return (JSON.parse(row.payload) as { message?: { order?: Record<string, unknown> } }).message?.order ?? null;
  }
  async listLogs(transactionId: string | null, limit: number) {
    const result = transactionId
      ? await this.db.prepare('SELECT * FROM ondc_protocol_logs WHERE transaction_id = ? ORDER BY id ASC LIMIT ?').bind(transactionId, limit).all<Record<string, unknown>>()
      : await this.db.prepare('SELECT * FROM ondc_protocol_logs ORDER BY id DESC LIMIT ?').bind(limit).all<Record<string, unknown>>();
    return result.results;
  }
  async consumeNonce(nonce: string, expires: number) {
    await this.db.prepare('CREATE TABLE IF NOT EXISTS ondc_runner_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)').run();
    const result = await this.db.prepare('INSERT OR IGNORE INTO ondc_runner_nonces (nonce, expires) VALUES (?, ?)').bind(nonce, expires).run();
    return Boolean(result.meta.changes);
  }
  async storeCallback(endpoint: string, rawPayload: string) {
    const { context } = JSON.parse(rawPayload) as { context: { action: string; transaction_id: string; message_id: string } };
    const receipt = JSON.stringify([context.transaction_id, context.message_id, context.action]);
    const now = Date.now();
    await this.db.batch([
      this.db.prepare('INSERT INTO ondc_callbacks (action, transaction_id, message_id, received_at, payload) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ondc_callback_receipts WHERE receipt_key = ?)')
        .bind(context.action, context.transaction_id, context.message_id, now, rawPayload, receipt),
      this.db.prepare("INSERT INTO ondc_protocol_logs (direction, action, transaction_id, message_id, endpoint, status_code, created_at, payload) SELECT 'INBOUND', ?, ?, ?, ?, 200, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ondc_callback_receipts WHERE receipt_key = ?)")
        .bind(context.action, context.transaction_id, context.message_id, endpoint, now, rawPayload, receipt),
      this.db.prepare('INSERT OR IGNORE INTO ondc_callback_receipts (receipt_key, received_at) VALUES (?, ?)').bind(receipt, now),
    ]);
  }
}

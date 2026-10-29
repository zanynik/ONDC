-- Existing callback rows stay intact. Receipts deduplicate subsequent deliveries.
CREATE TABLE IF NOT EXISTS ondc_callback_receipts (
  receipt_key TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ondc_callbacks_transaction_action
  ON ondc_callbacks (transaction_id, action, id);
CREATE INDEX IF NOT EXISTS ondc_protocol_logs_transaction
  ON ondc_protocol_logs (transaction_id, id);
CREATE TABLE IF NOT EXISTS ondc_runner_nonces (
  nonce TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

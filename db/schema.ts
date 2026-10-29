import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ondcCallbacks = sqliteTable("ondc_callbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  transactionId: text("transaction_id"),
  messageId: text("message_id"),
  receivedAt: integer("received_at").notNull(),
  payload: text("payload").notNull(),
});

export const ondcProtocolLogs = sqliteTable("ondc_protocol_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction").notNull(),
  action: text("action").notNull(),
  transactionId: text("transaction_id"),
  messageId: text("message_id"),
  endpoint: text("endpoint").notNull(),
  statusCode: integer("status_code"),
  createdAt: integer("created_at").notNull(),
  payload: text("payload").notNull(),
});

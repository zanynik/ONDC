CREATE TABLE `ondc_protocol_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`direction` text NOT NULL,
	`action` text NOT NULL,
	`transaction_id` text,
	`message_id` text,
	`endpoint` text NOT NULL,
	`status_code` integer,
	`created_at` integer NOT NULL,
	`payload` text NOT NULL
);

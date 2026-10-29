CREATE TABLE `ondc_callbacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`transaction_id` text,
	`message_id` text,
	`received_at` integer NOT NULL,
	`payload` text NOT NULL
);

ALTER TABLE `webhook` ADD `name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `webhook` ADD `last_seq` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `__new_webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`activity_seq` integer,
	`event` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`response_status` integer,
	`next_attempt_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_seq`) REFERENCES `activity`(`seq`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_webhook_delivery`("id", "webhook_id", "activity_seq", "event", "status", "attempts", "last_error", "response_status", "next_attempt_at", "created_at", "updated_at") SELECT "id", "webhook_id", "activity_seq", '', "status", "attempts", "last_error", NULL, NULL, "created_at", "updated_at" FROM `webhook_delivery`;
--> statement-breakpoint
DROP TABLE `webhook_delivery`;
--> statement-breakpoint
ALTER TABLE `__new_webhook_delivery` RENAME TO `webhook_delivery`;
--> statement-breakpoint
CREATE INDEX `webhook_delivery_webhook_status_idx` ON `webhook_delivery` (`webhook_id`,`status`);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`status`,`next_attempt_at`);

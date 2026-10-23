ALTER TABLE `notification` ADD `event_count` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `notification` ADD `sort_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `notification` SET `sort_at` = COALESCE(`snoozed_till`, `created_at`);
--> statement-breakpoint
CREATE INDEX `notification_inbox_idx` ON `notification` (`recipient_actor_id`,`archived_at`,`sort_at`);
--> statement-breakpoint
CREATE INDEX `notification_coalesce_idx` ON `notification` (`recipient_actor_id`,`work_item_id`,`actor_id`,`seq`);

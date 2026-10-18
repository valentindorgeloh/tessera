ALTER TABLE `actor` ADD `access` text DEFAULT 'write' NOT NULL;
--> statement-breakpoint
DROP INDEX `intake_item_work_item_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_item_work_item_uq` ON `intake_item` (`work_item_id`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `intake_item_status_snooze_idx` ON `intake_item` (`intake_id`, `status`, `snoozed_till`);
--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_active_uq` ON `estimate` (`project_id`) WHERE `archived_at` IS NULL AND `deleted_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `draft_work_item_updated_idx` ON `draft_work_item` (`updated_at`);

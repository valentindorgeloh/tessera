ALTER TABLE `export_job` ADD `name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `export_job` ADD `row_count` integer;
--> statement-breakpoint
CREATE INDEX `export_job_created_idx` ON `export_job` (`created_at`);
--> statement-breakpoint
CREATE INDEX `work_item_version_item_created_idx` ON `work_item_version` (`work_item_id`,`created_at`);

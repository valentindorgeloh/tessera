ALTER TABLE `workspace_settings` ADD `auto_backup` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_proposal` ADD `apply_batch_id` text;
--> statement-breakpoint
ALTER TABLE `ai_proposal` ADD `undone_at` text;
--> statement-breakpoint
ALTER TABLE `ai_proposal` ADD `undo_seq_from` integer;
--> statement-breakpoint
ALTER TABLE `ai_proposal` ADD `undo_seq_to` integer;
--> statement-breakpoint
CREATE INDEX `ai_proposal_batch_idx` ON `ai_proposal` (`apply_batch_id`);
--> statement-breakpoint
CREATE INDEX `ai_proposal_applied_idx` ON `ai_proposal` (`status`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `notification_archived_idx` ON `notification` (`archived_at`);
--> statement-breakpoint
CREATE INDEX `work_item_project_live_sort_idx` ON `work_item` (`project_id`,`deleted_at`,`archived_at`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `activity_workspace_seq_idx` ON `activity` (`seq`) WHERE project_id IS NULL;

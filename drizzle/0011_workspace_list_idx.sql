CREATE INDEX `work_item_live_sort_idx` ON `work_item` (`sort_order`,`sequence_id`) WHERE deleted_at IS NULL AND archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX `work_item_live_state_idx` ON `work_item` (`state_id`,`project_id`,`deleted_at`,`archived_at`) WHERE deleted_at IS NULL AND archived_at IS NULL;

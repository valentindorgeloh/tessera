CREATE INDEX `work_item_cycle_idx` ON `work_item` (`cycle_id`) WHERE cycle_id IS NOT NULL;

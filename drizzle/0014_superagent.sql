ALTER TABLE `comment` ADD `client_ref` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_client_ref_uq` ON `comment` (`actor_id`,`work_item_id`,`client_ref`) WHERE client_ref IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `workspace_settings` ADD `agents` text;

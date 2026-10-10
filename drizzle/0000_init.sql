CREATE TABLE `activity` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`project_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`work_item_id` text,
	`verb` text NOT NULL,
	`field` text,
	`old_value` text,
	`new_value` text,
	`old_identifier` text,
	`new_identifier` text,
	`comment` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_uid_uq` ON `activity` (`uid`);--> statement-breakpoint
CREATE INDEX `activity_project_seq_idx` ON `activity` (`project_id`,`seq`);--> statement-breakpoint
CREATE INDEX `activity_work_item_seq_idx` ON `activity` (`work_item_id`,`seq`);--> statement-breakpoint
CREATE INDEX `activity_actor_seq_idx` ON `activity` (`actor_id`,`seq`);--> statement-breakpoint
CREATE TABLE `actor` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`client_name` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actor_name_key_uq` ON `actor` (`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `automation_lease` (
	`id` text PRIMARY KEY DEFAULT 'automation' NOT NULL,
	`holder` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`parent_comment_id` text,
	`body_md` text NOT NULL,
	`body_version` integer DEFAULT 0 NOT NULL,
	`actor_id` text NOT NULL,
	`edited_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `comment_work_item_created_idx` ON `comment` (`work_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `comment_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reaction_uq` ON `comment_reaction` (`comment_id`,`actor_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `cycle` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`start_date` text,
	`end_date` text,
	`progress_snapshot` text,
	`archived_at` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `cycle_project_start_idx` ON `cycle` (`project_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `draft_work_item` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`state_id` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`parent_id` text,
	`cycle_id` text,
	`label_ids` text DEFAULT '[]' NOT NULL,
	`module_ids` text DEFAULT '[]' NOT NULL,
	`assignee_ids` text DEFAULT '[]' NOT NULL,
	`estimate_point_id` text,
	`start_date` text,
	`target_date` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`state_id`) REFERENCES `state`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_point_id`) REFERENCES `estimate_point`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `draft_work_item_project_idx` ON `draft_work_item` (`project_id`);--> statement-breakpoint
CREATE TABLE `estimate` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'points' NOT NULL,
	`last_used` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `estimate_project_idx` ON `estimate` (`project_id`);--> statement-breakpoint
CREATE TABLE `estimate_point` (
	`id` text PRIMARY KEY NOT NULL,
	`estimate_id` text NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `estimate_point_estimate_position_idx` ON `estimate_point` (`estimate_id`,`position`);--> statement-breakpoint
CREATE TABLE `export_job` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`file_path` text,
	`error` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `favorite` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`folder_id` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`folder_id`) REFERENCES `favorite_folder`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorite_entity_uq` ON `favorite` (`entity_type`,`entity_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `favorite_folder` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `intake` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `intake_project_idx` ON `intake` (`project_id`);--> statement-breakpoint
CREATE TABLE `intake_item` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_id` text NOT NULL,
	`work_item_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`snoozed_till` text,
	`duplicate_to_id` text,
	`source` text DEFAULT 'in_app' NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`intake_id`) REFERENCES `intake`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_to_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `intake_item_intake_status_idx` ON `intake_item` (`intake_id`,`status`);--> statement-breakpoint
CREATE INDEX `intake_item_work_item_idx` ON `intake_item` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `label` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_project_name_key_uq` ON `label` (`project_id`,`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `label_parent_idx` ON `label` (`parent_id`);--> statement-breakpoint
CREATE TABLE `mention` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`, `actor_id`),
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mention_actor_idx` ON `mention` (`actor_id`);--> statement-breakpoint
CREATE TABLE `module` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`lead_actor_id` text,
	`start_date` text,
	`target_date` text,
	`archived_at` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_project_name_key_uq` ON `module` (`project_id`,`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `module_link` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`metadata` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `module_link_module_idx` ON `module_link` (`module_id`);--> statement-breakpoint
CREATE TABLE `module_member` (
	`module_id` text NOT NULL,
	`actor_id` text NOT NULL,
	PRIMARY KEY(`module_id`, `actor_id`),
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`recipient_actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`work_item_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`actor_id` text,
	`read_at` text,
	`archived_at` text,
	`snoozed_till` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recipient_actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_uid_uq` ON `notification` (`uid`);--> statement-breakpoint
CREATE INDEX `notification_recipient_read_seq_idx` ON `notification` (`recipient_actor_id`,`read_at`,`seq`);--> statement-breakpoint
CREATE TABLE `page` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`parent_id` text,
	`name` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`description_version` integer DEFAULT 0 NOT NULL,
	`access` text DEFAULT 'public' NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`logo` text,
	`archived_at` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `page_project_idx` ON `page` (`project_id`);--> statement-breakpoint
CREATE INDEX `page_parent_idx` ON `page` (`parent_id`);--> statement-breakpoint
CREATE TABLE `page_embed` (
	`page_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`page_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_embed_entity_idx` ON `page_embed` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `page_label` (
	`page_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`page_id`, `label_id`),
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `page_version` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`name` text NOT NULL,
	`description_md` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `page`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `page_version_page_version_idx` ON `page_version` (`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`identifier` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`logo` text,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`cycles_enabled` integer DEFAULT true NOT NULL,
	`modules_enabled` integer DEFAULT true NOT NULL,
	`views_enabled` integer DEFAULT true NOT NULL,
	`pages_enabled` integer DEFAULT true NOT NULL,
	`intake_enabled` integer DEFAULT false NOT NULL,
	`estimates_enabled` integer DEFAULT false NOT NULL,
	`agent_intake_required` integer DEFAULT false NOT NULL,
	`estimate_id` text,
	`default_assignee_id` text,
	`archive_in_months` integer,
	`close_in_months` integer,
	`close_state_id` text,
	`archived_at` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimate`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_assignee_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`close_state_id`) REFERENCES `state`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_identifier_uq` ON `project` (`identifier`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_name_key_uq` ON `project` (`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `quick_link` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `recent_visit` (
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`visited_at` text NOT NULL,
	PRIMARY KEY(`entity_type`, `entity_id`)
);
--> statement-breakpoint
CREATE INDEX `recent_visit_visited_idx` ON `recent_visit` (`visited_at`);--> statement-breakpoint
CREATE TABLE `state` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`state_group` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `state_project_name_key_uq` ON `state` (`project_id`,`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `state_project_default_uq` ON `state` (`project_id`) WHERE is_default = 1 AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `state_project_group_idx` ON `state` (`project_id`,`state_group`);--> statement-breakpoint
CREATE TABLE `sticky` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `view` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`filters` text NOT NULL,
	`rich_filters` text,
	`display` text NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`logo` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `view_project_name_key_uq` ON `view` (`project_id`,`name_key`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `view_settings` (
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`filters` text NOT NULL,
	`display` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE TABLE `webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`activity_seq` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_seq`) REFERENCES `activity`(`seq`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_webhook_status_idx` ON `webhook_delivery` (`webhook_id`,`status`);--> statement-breakpoint
CREATE TABLE `work_item` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sequence_id` integer NOT NULL,
	`name` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`description_version` integer DEFAULT 0 NOT NULL,
	`state_id` text NOT NULL,
	`priority` text DEFAULT 'none' NOT NULL,
	`parent_id` text,
	`cycle_id` text,
	`estimate_point_id` text,
	`start_date` text,
	`target_date` text,
	`completed_at` text,
	`archived_at` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`sort_order` text NOT NULL,
	`external_source` text,
	`external_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_id`) REFERENCES `state`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_point_id`) REFERENCES `estimate_point`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_project_sequence_uq` ON `work_item` (`project_id`,`sequence_id`);--> statement-breakpoint
CREATE INDEX `work_item_project_state_idx` ON `work_item` (`project_id`,`state_id`);--> statement-breakpoint
CREATE INDEX `work_item_project_cycle_idx` ON `work_item` (`project_id`,`cycle_id`);--> statement-breakpoint
CREATE INDEX `work_item_parent_idx` ON `work_item` (`parent_id`);--> statement-breakpoint
CREATE INDEX `work_item_project_sort_idx` ON `work_item` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `work_item_assignee` (
	`work_item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `actor_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_item_assignee_actor_idx` ON `work_item_assignee` (`actor_id`);--> statement-breakpoint
CREATE TABLE `work_item_label` (
	`work_item_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `label_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `label`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_item_label_label_idx` ON `work_item_label` (`label_id`);--> statement-breakpoint
CREATE TABLE `work_item_link` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`metadata` text,
	`sort_order` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `work_item_link_work_item_idx` ON `work_item_link` (`work_item_id`);--> statement-breakpoint
CREATE TABLE `work_item_module` (
	`work_item_id` text NOT NULL,
	`module_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `module_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_item_module_module_idx` ON `work_item_module` (`module_id`);--> statement-breakpoint
CREATE TABLE `work_item_reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_reaction_uq` ON `work_item_reaction` (`work_item_id`,`actor_id`,`reaction`);--> statement-breakpoint
CREATE TABLE `work_item_relation` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`related_work_item_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_item_relation_pair_uq` ON `work_item_relation` (`work_item_id`,`related_work_item_id`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `work_item_relation_related_idx` ON `work_item_relation` (`related_work_item_id`);--> statement-breakpoint
CREATE TABLE `work_item_subscriber` (
	`work_item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `actor_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `work_item_subscriber_actor_idx` ON `work_item_subscriber` (`actor_id`);--> statement-breakpoint
CREATE TABLE `work_item_version` (
	`id` text PRIMARY KEY NOT NULL,
	`work_item_id` text NOT NULL,
	`name` text NOT NULL,
	`description_md` text NOT NULL,
	`version` integer NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actor`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `work_item_version_item_version_idx` ON `work_item_version` (`work_item_id`,`version`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY DEFAULT 'workspace' NOT NULL,
	`name` text DEFAULT 'Tessera' NOT NULL,
	`home_widgets` text DEFAULT '[]' NOT NULL,
	`ai` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

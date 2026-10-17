CREATE TABLE IF NOT EXISTS `ai_digest` (
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`input_seq` integer NOT NULL,
	`body_md` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`kind`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`source` text NOT NULL,
	`tool` text NOT NULL,
	`input` text NOT NULL,
	`preview` text NOT NULL,
	`destructive` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`project_id` text,
	`tool_use_id` text,
	`result` text,
	`error_code` text,
	`error_message` text,
	`seq_from` integer,
	`seq_to` integer,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_proposal_conversation_idx` ON `ai_proposal` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_proposal_status_idx` ON `ai_proposal` (`status`,`created_at`);
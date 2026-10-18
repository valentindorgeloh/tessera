import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DigestKind, ProposalPreview, ProposalSource, ProposalStatus, TrackerErrorCode } from "../../types";
import { project } from "./core";

// ===========================================================================
// AI (P5, decisions 33 and 37)
//
// Bookkeeping, not tracker data (decision 34): no audit columns, no
// `deleted_at`, no activity rows. Written only by `src/lib/tessera/ai/**`.
// ===========================================================================

/** One assistant write waiting for Apply, or its outcome (decision 33). */
export const ai_proposal = sqliteTable(
  "ai_proposal",
  {
    id: text("id").primaryKey(),
    /** Client-made uuid of the conversation (decision 35). */
    conversation_id: text("conversation_id").notNull(),
    source: text("source").$type<ProposalSource>().notNull(),
    /** Registry name of a mutating tool. */
    tool: text("tool").notNull(),
    /** The validated tool input; Apply runs this, never client input. */
    input: text("input", { mode: "json" }).$type<unknown>().notNull(),
    preview: text("preview", { mode: "json" }).$type<ProposalPreview>().notNull(),
    /** Copied from the ToolDef when proposed. */
    destructive: integer("destructive", { mode: "boolean" }).notNull(),
    status: text("status").$type<ProposalStatus>().notNull().default("pending"),
    project_id: text("project_id").references(() => project.id, { onDelete: "set null" }),
    /** The model's tool_use id; links the SSE events to the row. */
    tool_use_id: text("tool_use_id"),
    result: text("result", { mode: "json" }).$type<unknown>(),
    error_code: text("error_code").$type<TrackerErrorCode | "INTERNAL">(),
    error_message: text("error_message"),
    /** Activity range Apply wrote; lets P11 undo find the rows. */
    seq_from: integer("seq_from"),
    seq_to: integer("seq_to"),
    /** Shared id for every proposal applied in one Apply call (decision 116). */
    apply_batch_id: text("apply_batch_id"),
    /** When this applied proposal was undone with the rest of its batch. */
    undone_at: text("undone_at"),
    undo_seq_from: integer("undo_seq_from"),
    undo_seq_to: integer("undo_seq_to"),
    created_at: text("created_at").notNull(),
    /** Set at apply, fail or discard. */
    decided_at: text("decided_at"),
  },
  (t) => [
    index("ai_proposal_conversation_idx").on(t.conversation_id, t.created_at),
    index("ai_proposal_status_idx").on(t.status, t.created_at),
    index("ai_proposal_batch_idx").on(t.apply_batch_id),
    index("ai_proposal_applied_idx").on(t.status, t.decided_at),
  ],
);

/** The stored digest of one cycle, module or inbox (decision 37); regenerating overwrites the row. */
export const ai_digest = sqliteTable(
  "ai_digest",
  {
    kind: text("kind").$type<DigestKind>().notNull(),
    /** Cycle id, module id, or the recipient actor id. No foreign key: the target table depends on `kind`. */
    entity_id: text("entity_id").notNull(),
    /** Highest activity seq the digest summarised. */
    input_seq: integer("input_seq").notNull(),
    body_md: text("body_md").notNull(),
    /** Model id that answered (`response.model`). */
    model: text("model").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.entity_id] })],
);

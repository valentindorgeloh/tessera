/**
 * Assistant proposals (decision 33, decision 34). A row is bookkeeping: it
 * writes no activity and does not move the change cursor. Apply runs the
 * stored input through the registry as actor `assistant`.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ASSISTANT_ACTOR_ID } from "../actors";
import { latestSeq } from "../activity";
import { createContext, type TesseraContext } from "../core/context";
import { conflict, fromSqliteError, isTrackerError, notFound, rule, validateInput } from "../core/errors";
import { newId } from "../core/ids";
import type { DbHandles } from "../db/client";
import { ai_proposal } from "../db/schema";
import { IdSchema, ProposalSourceSchema } from "../schemas";
import { getTool } from "../tools/registry";
import type { ApplyOutcome, ProposalPreview, ProposalStatus, ProposalView } from "../types";
import { withTx } from "../core/tx";
import { previewTool } from "./preview";

const HOUR_MS = 60 * 60 * 1000;
export const PROPOSAL_TTL_MS = 24 * HOUR_MS;

export const CreateProposalInput = z
  .object({
    conversation_id: z.uuid().describe("Client uuid of the conversation."),
    source: ProposalSourceSchema.describe("Chat or view from prompt."),
    tool: z.string().min(1).describe("Registry name of a mutating tool."),
    input: z.unknown().describe("Tool input, validated by the tool schema."),
    project_id: IdSchema.nullable().default(null).describe("Project the conversation is about, or null."),
    tool_use_id: z.string().nullable().default(null).describe("The model's tool_use id, or null."),
  })
  .strict();

export const ApplyProposalsInput = z
  .object({
    ids: z.array(IdSchema).min(1).max(50).describe("Proposals to apply, in this order."),
    confirmed_ids: z.array(IdSchema).default([]).describe("Destructive proposals the person confirmed."),
  })
  .strict();

type ProposalRow = typeof ai_proposal.$inferSelect;

function toView(row: ProposalRow): ProposalView {
  const preview = row.preview as ProposalPreview;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    source: row.source,
    tool: row.tool,
    title: preview.title,
    input: row.input,
    preview,
    destructive: row.destructive,
    status: row.status,
    error: row.error_code === null ? null : { code: row.error_code, message: row.error_message ?? "" },
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

function load(ctx: TesseraContext, id: string): ProposalRow {
  const row = ctx.db.select().from(ai_proposal).where(eq(ai_proposal.id, id)).get();
  if (!row) throw notFound("proposal", id);
  return row;
}

function expired(row: ProposalRow, now: string): boolean {
  return Date.parse(now) - Date.parse(row.created_at) > PROPOSAL_TTL_MS;
}

function ruleName(err: unknown): string | undefined {
  if (!isTrackerError(err) || err.code !== "RULE") return undefined;
  const details = err.details as { rule?: string } | undefined;
  return details?.rule;
}

function outcomeError(err: unknown): NonNullable<ApplyOutcome["error"]> {
  const mapped = fromSqliteError(err);
  if (isTrackerError(mapped)) return { code: mapped.code, message: mapped.message };
  return { code: "INTERNAL", message: mapped instanceof Error ? mapped.message : "Unexpected error" };
}

/** Stores a validated proposal. Read tools and unknown tools are refused. Writes no activity (decision 34). */
export function createProposal(ctx: TesseraContext, input: z.input<typeof CreateProposalInput>): ProposalView {
  const data = validateInput(CreateProposalInput, input);
  const def = getTool(data.tool);
  const preview = previewTool(ctx, data.tool, data.input);
  const row = withTx(ctx, () =>
    ctx.db
      .insert(ai_proposal)
      .values({
        id: newId(),
        conversation_id: data.conversation_id,
        source: data.source,
        tool: data.tool,
        input: validateInput(def.input, data.input),
        preview,
        destructive: def.destructive === true,
        status: "pending",
        project_id: data.project_id,
        tool_use_id: data.tool_use_id,
        created_at: ctx.now(),
      })
      .returning()
      .get(),
  );
  return toView(row);
}

/** Proposals of one conversation, oldest first. */
export function listProposals(ctx: TesseraContext, input: { conversation_id: string }): ProposalView[] {
  const id = validateInput(z.uuid(), input.conversation_id);
  return ctx.db
    .select()
    .from(ai_proposal)
    .where(eq(ai_proposal.conversation_id, id))
    .orderBy(asc(ai_proposal.created_at))
    .all()
    .map(toView);
}

/** One proposal, or NOT_FOUND. */
export function getProposal(ctx: TesseraContext, id: string): ProposalView {
  return toView(load(ctx, id));
}

function recordFailure(ctx: TesseraContext, id: string, err: unknown): void {
  const error = outcomeError(err);
  withTx(ctx, () => {
    ctx.db
      .update(ai_proposal)
      .set({ status: "failed", error_code: error.code, error_message: error.message, decided_at: ctx.now() })
      .where(and(eq(ai_proposal.id, id), eq(ai_proposal.status, "pending")))
      .run();
  });
}

/** Applies one stored proposal as the context actor. The caller passes an assistant context. */
export function applyProposal(
  ctx: TesseraContext,
  id: string,
  options: { confirmed: boolean; batch_id?: string },
): ApplyOutcome {
  const row = load(ctx, id);
  if (row.status !== "pending") throw conflict("already_decided", { status: row.status });
  if (expired(row, ctx.now())) throw rule("proposal_expired", "This proposal is older than 24 hours");
  if (row.destructive && !options.confirmed) throw rule("needs_confirmation", "This proposal needs confirmation");
  try {
    return withTx(ctx, () => {
      const claimed = ctx.db
        .update(ai_proposal)
        .set({ status: "applying" })
        .where(and(eq(ai_proposal.id, id), eq(ai_proposal.status, "pending")))
        .returning()
        .get();
      if (!claimed) throw conflict("already_decided");
      const def = getTool(claimed.tool);
      const data = validateInput(def.input, claimed.input);
      const seqFrom = latestSeq(ctx) + 1;
      const out = def.run(ctx, data);
      if (out instanceof Promise) throw new Error("mutating tools are sync");
      const seqTo = latestSeq(ctx);
      const saved = ctx.db
        .update(ai_proposal)
        .set({
          status: "applied",
          result: out,
          seq_from: seqFrom,
          seq_to: seqTo,
          apply_batch_id: options.batch_id ?? newId(),
          decided_at: ctx.now(),
        })
        .where(eq(ai_proposal.id, id))
        .returning()
        .get();
      return { id, status: "applied" as const, data: out, ...(saved ? {} : {}) };
    });
  } catch (err) {
    recordFailure(ctx, id, err);
    throw err;
  }
}

function caught(id: string, err: unknown): ApplyOutcome {
  const name = ruleName(fromSqliteError(err));
  const status: ApplyOutcome["status"] = name === "needs_confirmation" || name === "proposal_expired" ? "pending" : "failed";
  return { id, status, error: outcomeError(err) };
}

/** Applies each id in order and continues past failures. The context is actor `assistant`. */
export function applyProposals(handles: DbHandles, input: z.input<typeof ApplyProposalsInput>): ApplyOutcome[] {
  const data = validateInput(ApplyProposalsInput, input);
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: ASSISTANT_ACTOR_ID });
  const confirmed = new Set(data.confirmed_ids);
  const batchId = newId();
  return data.ids.map((id) => {
    try {
      return applyProposal(ctx, id, { confirmed: confirmed.has(id), batch_id: batchId });
    } catch (err) {
      return caught(id, err);
    }
  });
}

/** Discards pending proposals. Any other status is returned unchanged. */
export function discardProposals(ctx: TesseraContext, input: { ids: string[] }): ProposalView[] {
  const data = validateInput(z.object({ ids: z.array(IdSchema).min(1).max(50) }).strict(), input);
  return withTx(ctx, () =>
    data.ids.map((id) => {
      const row = load(ctx, id);
      if (row.status !== "pending") return toView(row);
      const saved = ctx.db
        .update(ai_proposal)
        .set({ status: "discarded" satisfies ProposalStatus, decided_at: ctx.now() })
        .where(and(eq(ai_proposal.id, id), eq(ai_proposal.status, "pending")))
        .returning()
        .get();
      return toView(saved ?? row);
    }),
  );
}

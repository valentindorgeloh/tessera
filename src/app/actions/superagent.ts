"use server";

/**
 * Superagent control (decision 152; docs/contracts/ui.md "Superagent
 * control"). Server Actions over the runner client, not registry tools:
 * `withRunner` adds the token and the runner URL, so neither reaches the
 * browser, and no MCP client or assistant proposal can drive the runner. Each
 * action validates its input first (a bad one is a `validation` failure with
 * no runner call), runs the call, then `refresh()`es outside any try, also
 * after a runner failure, so the screen shows what the runner now says.
 * Every action returns a `RunnerResult`: a runner failure (and an unreadable
 * token file) comes back as a state, never as a thrown error. Reading the
 * runner URL is a Tessera database read, and a database error propagates
 * like on every other screen.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import {
  RequestSizeSchema,
  RevisionSchema,
  RunnerSettingsSchema,
  SimpleActionSchema,
  TeamSectionSchema,
} from "@/lib/superagent/schemas";
import type { RunnerClient } from "@/lib/superagent/client";
import { withRunner } from "@/lib/superagent/server";
import type {
  RequestSize,
  RequestSummary,
  Revision,
  RunnerPromptsDoc,
  RunnerResult,
  RunnerSettings,
  RunnerSettingsDoc,
  SimpleAction,
  TeamSection,
  TriageRow,
} from "@/lib/superagent/types";

const RunnerId = z.string().min(1).max(200);

const PauseInput = z.object({ paused: z.boolean() });
const RequestActionInput = z.object({ request_id: RunnerId, action: SimpleActionSchema });
const ResizeInput = z.object({ request_id: RunnerId, size: RequestSizeSchema });
const BudgetInput = z.object({ request_id: RunnerId, usd: z.number().gt(0).max(10000) });
const RetryTriageInput = z.object({ triage_id: RunnerId });
const SaveSettingsInput = z.object({ settings: RunnerSettingsSchema, base_revision: RevisionSchema });
const SavePromptsInput = z.object({ team_sections: z.array(TeamSectionSchema).max(200), base_revision: RevisionSchema });

/** Validates `input`, runs `call` against the runner and refreshes the page; a bad input never reaches the runner. */
async function act<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  call: (client: RunnerClient, data: z.output<S>) => Promise<RunnerResult<T>>,
): Promise<RunnerResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.map(String).join(".")}: `;
    return { ok: false, failure: { state: "validation", message: `${where}${issue?.message ?? "Invalid input"}`, status: null, code: null } };
  }
  const result = await withRunner((client) => call(client, parsed.data));
  refresh();
  return result;
}

/** Pauses or resumes the runner's new work. */
export async function superagentPauseAction(input: { paused: boolean }): Promise<RunnerResult<{ paused: boolean }>> {
  return act(PauseInput, input, (client, data) => client.setPaused(data.paused));
}

/** Approve, retry, stop or lift the hold on a request. Stop is final. */
export async function superagentRequestAction(input: { request_id: string; action: SimpleAction }): Promise<RunnerResult<RequestSummary>> {
  return act(RequestActionInput, input, (client, data) => client.requestAction(data.request_id, data.action));
}

export async function superagentResizeAction(input: { request_id: string; size: RequestSize }): Promise<RunnerResult<RequestSummary>> {
  return act(ResizeInput, input, (client, data) => client.resize(data.request_id, data.size));
}

/** Sets a request's budget in USD (above 0, at most 10000). */
export async function superagentBudgetAction(input: { request_id: string; usd: number }): Promise<RunnerResult<RequestSummary>> {
  return act(BudgetInput, input, (client, data) => client.setBudget(data.request_id, data.usd));
}

export async function superagentRetryTriageAction(input: { triage_id: string }): Promise<RunnerResult<TriageRow>> {
  return act(RetryTriageInput, input, (client, data) => client.retryTriage(data.triage_id));
}

/** Saves the runner's settings; a stale `base_revision` comes back as a `conflict`. */
export async function superagentSaveSettingsAction(input: {
  settings: RunnerSettings;
  base_revision: Revision;
}): Promise<RunnerResult<RunnerSettingsDoc>> {
  return act(SaveSettingsInput, input, (client, data) => client.putSettings(data.settings, data.base_revision));
}

/** Saves the team sections (every one the screen sends); a stale `base_revision` comes back as a `conflict`. */
export async function superagentSavePromptsAction(input: {
  team_sections: TeamSection[];
  base_revision: Revision;
}): Promise<RunnerResult<RunnerPromptsDoc>> {
  return act(SavePromptsInput, input, (client, data) => client.putPrompts(data.team_sections, data.base_revision));
}

/** Re-renders the page (the screen polls this) without calling the runner. */
export async function superagentRefreshAction(): Promise<void> {
  refresh();
}

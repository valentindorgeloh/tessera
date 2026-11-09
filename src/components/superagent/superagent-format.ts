/**
 * Pure helpers of the Superagent screen (decision 145; docs/contracts/ui.md
 * "Superagent control", "Shared helpers"). No React and no Astryx, so Vitest
 * reaches them and the page can use `parseScope`. Lane U2's forms import
 * `failureCopy`, `formatUsd` and `ProjectOption` from here.
 */
import type { AgentSettings } from "@/lib/tessera/types";
import {
  REQUEST_SCOPES,
  type Deliverable,
  type PullRequest,
  type RequestScope,
  type RequestSize,
  type RequestSummary,
  type RunnerAction,
  type RunnerFailure,
  type RunnerPromptsDoc,
  type RunnerResult,
  type RunnerState,
  type StageKind,
  type TriageRow,
} from "@/lib/superagent/types";

/** A project the mapping form knows (the page maps `listProjects`, live and archived, to this); only live ones can be picked, an archived one stays on a row that already maps it. */
export type ProjectOption = { id: string; name: string; identifier: string; archived: boolean };

/** The status variants the screen uses for a stage, a health state and the spend bar. */
export type DotVariant = "success" | "warning" | "error" | "accent" | "neutral";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** Needs-failed is an error, every other needs-you stage a warning; working is accent, done success and the rest neutral. */
export function stageVariant(kind: StageKind): DotVariant {
  if (kind === "needs_failed") return "error";
  if (kind.startsWith("needs_")) return "warning";
  if (kind === "working") return "accent";
  if (kind === "done") return "success";
  return "neutral";
}

/** The order of "Needs you": what waits for the user first, finished work last. */
export const STAGE_ORDER: readonly StageKind[] = [
  "needs_delivery",
  "needs_question",
  "needs_signoff",
  "needs_hold",
  "needs_review",
  "needs_blocked",
  "needs_failed",
  "paused",
  "queued",
  "working",
  "done",
  "dropped",
  "stopped",
];

function newestFirst(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return a < b ? 1 : a > b ? -1 : 0;
  return y - x;
}

/** By stage order, then `updatedAt` newest first; equal rows keep their order. Never mutates its input. */
export function sortRequests<T extends Pick<RequestSummary, "stage" | "updatedAt">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => STAGE_ORDER.indexOf(a.stage.kind) - STAGE_ORDER.indexOf(b.stage.kind) || newestFirst(a.updatedAt, b.updatedAt));
}

export const ACTION_LABELS: Readonly<Record<RunnerAction, string>> = {
  approve: "Approve",
  retry: "Retry",
  stop: "Stop…",
  resize: "Resize…",
  budget: "Budget…",
  lift_hold: "Lift hold",
};

/** The action's name without the ellipsis of a dialog row: "Stop…" is "Stop" in a Toast. */
export function actionVerb(action: RunnerAction): string {
  return ACTION_LABELS[action].replace(/…$/, "");
}

const PRIMARY_ORDER: readonly RunnerAction[] = ["approve", "lift_hold", "retry"];

/** The one action a row shows as a button: the first of approve, lift hold, retry that is listed. */
export function primaryAction(actions: readonly RunnerAction[]): "approve" | "lift_hold" | "retry" | null {
  const found = PRIMARY_ORDER.find((action) => actions.includes(action));
  return found === "approve" || found === "lift_hold" || found === "retry" ? found : null;
}

export type FailureCopy = { status: "info" | "warning" | "error"; title: string; body: string };
/** What the words of a failure name: the token file and the runner URL of the load (`SuperagentLoad`). */
export type FailureContext = { tokenFile: string; runnerUrl: string };

/** The words for a failed runner call (the banner, a section's one line, a Toast). */
export function failureCopy(failure: RunnerFailure, { tokenFile, runnerUrl }: FailureContext): FailureCopy {
  const { message } = failure;
  switch (failure.state) {
    case "not_set_up":
      return { status: "info", title: "Runner not set up", body: `Tessera reads the runner's token from ${tokenFile}. Start the superagent runner once to create it.` };
    case "token_unreadable":
      return { status: "error", title: "Token file unreadable", body: `Tessera cannot read ${tokenFile} (${message}).` };
    case "unreachable":
      return { status: "warning", title: "Runner not answering", body: `Nothing answers at ${runnerUrl}. Check that the runner is running.` };
    case "timeout":
      return { status: "warning", title: "Runner timed out", body: `The runner at ${runnerUrl} did not answer within 5 seconds.` };
    case "unauthorized":
      return { status: "error", title: "Token rejected", body: `The runner rejected Tessera's token. Restart the runner or check ${tokenFile}.` };
    case "forbidden":
      return { status: "error", title: "Request refused", body: message };
    case "not_found":
      return { status: "warning", title: "Not found", body: message };
    case "validation":
      return { status: "error", title: "Not accepted", body: message };
    case "conflict":
      return { status: "warning", title: "Changed elsewhere", body: "The latest values are loaded." };
    case "unavailable":
      return { status: "warning", title: "Runner unavailable", body: message };
    case "bad_response":
      return { status: "error", title: "Unexpected answer", body: `The runner's answer does not match the API contract (v1): ${message}` };
    case "http_error":
      return { status: "error", title: "Runner error", body: `The runner answered ${failure.status ?? "with an error"}: ${message}` };
  }
}

/** A Toast for a failed action: what was tried, then the failure's own title and body. */
export function failureToast(what: string, copy: FailureCopy): string {
  return `${what}. ${copy.title}. ${copy.body}`;
}

/** What a failed request action was trying to do: "Could not approve TES-142". */
export function actionFailureText(action: RunnerAction, itemKey: string): string {
  switch (action) {
    case "approve":
      return `Could not approve ${itemKey}`;
    case "retry":
      return `Could not retry ${itemKey}`;
    case "stop":
      return `Could not stop ${itemKey}`;
    case "resize":
      return `Could not resize ${itemKey}`;
    case "budget":
      return `Could not change the budget of ${itemKey}`;
    case "lift_hold":
      return `Could not lift the hold on ${itemKey}`;
  }
}

/**
 * The line a runner-backed part shows in place of its content: "Not available:
 * {title}." when the runner's state itself failed (the banner explains), the
 * failure's title alone when only this part's load failed, else null.
 */
export function sectionNote(state: RunnerResult<unknown>, own: RunnerResult<unknown>, context: FailureContext): string | null {
  if (!state.ok) return `Not available: ${failureCopy(state.failure, context).title}.`;
  return own.ok ? null : failureCopy(own.failure, context).title;
}

/** `?scope=`: `open` unless the value is one of the three scopes. */
export function parseScope(value: string | string[] | undefined): RequestScope {
  const first = Array.isArray(value) ? value[0] : value;
  return REQUEST_SCOPES.find((scope) => scope === first) ?? "open";
}

/** `?request=`: a runner request id (1 to 200 characters) or null. */
export function parseRequestId(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first !== undefined && first.length >= 1 && first.length <= 200 ? first : null;
}

/** The screen's own URL: `?scope=` and, with a selection, `&request=`. */
export function superagentHref(scope: RequestScope, requestId: string | null): string {
  const params = new URLSearchParams({ scope });
  if (requestId !== null) params.set("request", requestId);
  return `/agents/superagent?${params.toString()}`;
}

/** Size, plus the deliverable when it is not a pull request: "M", "S · answer". */
export function sizeLabel(size: RequestSize, deliverable: Deliverable): string {
  return deliverable === "pr" ? size : `${size} · ${deliverable}`;
}

/** A pull request as its number with a hash sign, then its state. */
export function prLabel(pr: PullRequest): string {
  return `#${pr.number} ${pr.state}`;
}

export const HEALTH_LABEL: Readonly<Record<RunnerState["health"]["status"], string>> = {
  ok: "Healthy",
  degraded: "Degraded",
  setup_failed: "Setup failed",
};

export function healthVariant(status: RunnerState["health"]["status"]): DotVariant {
  if (status === "ok") return "success";
  return status === "degraded" ? "warning" : "error";
}

/** The spend bar's variant: warning from 80% of the daily cap and error from 100%. Without a cap it stays accent. */
export function spendVariant(todayUsd: number, dailyCapUsd: number): "accent" | "warning" | "error" {
  if (dailyCapUsd <= 0) return "accent";
  if (todayUsd >= dailyCapUsd) return "error";
  return todayUsd >= dailyCapUsd * 0.8 ? "warning" : "accent";
}

/** "$6.40 of $20.00": a request's cost of its budget, and today's spend of the daily cap. */
export function usdOf(amountUsd: number, limitUsd: number): string {
  return `${formatUsd(amountUsd)} of ${formatUsd(limitUsd)}`;
}

/** The "Paused" banner's text; a pause without a stated reason reads as the user's. */
export function pausedBody(reason: RunnerState["pauseReason"]): string {
  return reason === "daily_cap" ? "The daily cap is reached; new work waits until tomorrow." : "Paused by you.";
}

export function rewoundBody(cursor: number, latestSeq: number): string {
  return `The runner's cursor (${cursor}) is past Tessera's newest change (${latestSeq}), as after a restore. Intake stays stopped until the runner is reset.`;
}

/** The "Runner setup failed" banner's text: the failed checks by name, with their detail. */
export function setupFailedBody(checks: RunnerState["health"]["checks"]): string {
  const failed = checks.filter((check) => !check.ok).map((check) => (check.detail ? `${check.name} (${check.detail})` : check.name));
  return failed.length === 0 ? "The runner reports that its setup failed." : `Failed checks: ${failed.join("; ")}.`;
}

/** "3 queued, 1 running" from the triage rows (a triage that decided or is unavailable counts in neither). */
export function triageSummary(rows: readonly TriageRow[]): string {
  const queued = rows.filter((row) => row.status === "queued").length;
  const running = rows.filter((row) => row.status === "running").length;
  return `${queued} queued, ${running} running`;
}

/** "cursor 412, Tessera at 412". */
export function intakeSummary(intake: RunnerState["intake"]): string {
  return `cursor ${intake.cursor}, Tessera at ${intake.latestSeq}`;
}

/** The first-pass review rate (a fraction) as a whole percent, or "No reviews yet". */
export function reviewRateLabel(rate: number | null): string {
  return rate === null ? "No reviews yet" : `${Math.round(rate * 100)}%`;
}

/** "review_failed: 3, tests_failed: 2", or "None". */
export function escalationsLabel(escalations: readonly { cause: string; count: number }[]): string {
  return escalations.length === 0 ? "None" : escalations.map((entry) => `${entry.cause}: ${entry.count}`).join(", ");
}

/** The models of a request as a comma list; "None yet" before the first session. */
export function modelsLabel(models: readonly string[]): string {
  return models.length === 0 ? "None yet" : models.join(", ");
}

/** The events of a request, newest first, without touching the prop (v1 gives no order; the fixture is oldest first). */
export function eventsNewestFirst<T extends { at: string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => newestFirst(a.at, b.at));
}

/**
 * The repositories the team sections can show: the mapped ones plus those
 * already in the runner's `teamSections` (when they loaded), without
 * duplicates, sorted.
 */
export function teamRepos(agents: AgentSettings | null, prompts: RunnerResult<RunnerPromptsDoc>): string[] {
  const repos = new Set<string>();
  for (const mapping of agents?.projects ?? []) repos.add(mapping.repo);
  if (prompts.ok) for (const section of prompts.data.teamSections) repos.add(section.repo);
  return [...repos].sort((a, b) => a.localeCompare(b));
}

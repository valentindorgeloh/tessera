/**
 * What the setup guide's status block says (decision 155; docs/contracts/ui.md "Superagent control",
 * "Setup guide"): the four "Where you are" rows and the Done / To do / Not checked state of each
 * step, computed from one `SuperagentSetupLoad`. Pure, no React, so Vitest reaches it. The page
 * also uses `tesseraUrlFromHost`.
 */
import type { RunnerState, SuperagentSetupLoad } from "@/lib/superagent/types";
import { DOCTOR_CHECKS, SETUP_STEPS, type SetupStepId } from "./setup-guide";
import { failureCopy, setupFailedBody, type DotVariant, type FailureContext } from "./superagent-format";

export type StepState = "done" | "todo" | "unknown";

export const STEP_STATE_COPY: Readonly<Record<StepState, { variant: DotVariant; label: string }>> = {
  done: { variant: "success", label: "Done" },
  todo: { variant: "warning", label: "To do" },
  unknown: { variant: "neutral", label: "Not checked" },
};

/** `<name or [ipv6]>:<port>`: the host name is not needed, only the port. */
const HOST_WITH_PORT = /^(?:\[[^\]]+\]|[^:[\]]+):(\d+)$/;

/** `http://127.0.0.1:<port>` from the request's Host header, or null. Always 127.0.0.1: Tessera binds it, and Node may resolve `localhost` to ::1 first. */
export function tesseraUrlFromHost(host: string | null): string | null {
  const match = host === null ? null : HOST_WITH_PORT.exec(host.trim());
  if (match === null) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? `http://127.0.0.1:${port}` : null;
}

/** The step that fixes a doctor or health check, by name (`repo <name>` → "repos"); null for an unknown name and for `intake`. */
export function stepForCheck(name: string): SetupStepId | null {
  const check = DOCTOR_CHECKS.find((entry) => (entry.isPrefix === true ? name.startsWith(entry.name) : entry.name === name));
  return check?.stepId ?? null;
}

/** The number a step shows (its index in SETUP_STEPS; "Before you start" is 0 and shows no number). */
export function stepNumber(id: SetupStepId): number {
  return SETUP_STEPS.findIndex((step) => step.id === id);
}

/** "Step 9", or "Before you start" for step 0. */
export function stepLinkLabel(id: SetupStepId): string {
  const n = stepNumber(id);
  return n === 0 ? "Before you start" : `Step ${n}`;
}

/** `#setup-step-<id>`. */
export function stepAnchor(id: SetupStepId): string {
  return `#setup-step-${id}`;
}

/** Whether something answered at the runner URL: the state loaded, or failed with an HTTP answer. A running runner has passed every setup check (it exits 3 otherwise). */
export function runnerAnswered(state: SuperagentSetupLoad["state"]): boolean {
  if (state === null) return false;
  if (state.ok) return true;
  return !["not_set_up", "token_unreadable", "unreachable", "timeout"].includes(state.failure.state);
}

function failingSteps(state: SuperagentSetupLoad["state"]): Set<SetupStepId> {
  const steps = new Set<SetupStepId>();
  if (state?.ok !== true) return steps;
  for (const check of state.data.health.checks) {
    const step = check.ok ? null : stepForCheck(check.name);
    if (step !== null) steps.add(step);
  }
  return steps;
}

export function stepStates(load: SuperagentSetupLoad): Readonly<Record<SetupStepId, StepState | null>> {
  const { token, state, mappedProjects, isConnected } = load;
  const failing = failingSteps(state);
  const answered = runnerAnswered(state);
  const checked = (id: SetupStepId): StepState => (!answered ? "unknown" : failing.has(id) ? "todo" : "done");
  const isUnauthorized = state !== null && !state.ok && state.failure.state === "unauthorized";
  return {
    before: null,
    runner: token.kind === "found" && token.isPrivate !== false ? "done" : "todo",
    "api-key": checked("api-key"),
    "agent-account": checked("agent-account"),
    "agent-token": checked("agent-token"),
    "agent-login": checked("agent-login"),
    "agent-identity": checked("agent-identity"),
    repos: checked("repos"),
    // Nothing checks the agent's access to the repositories.
    access: "unknown",
    connect: mappedProjects.length === 0 || failing.has("connect") || isUnauthorized ? "todo" : isConnected ? "done" : "unknown",
    // A runner that answers counts as started, unless it reports a failing check: step 10's "done when" asks for a healthy runner.
    start: state === null ? "unknown" : !answered || (state.ok && state.data.health.status !== "ok") ? "todo" : "done",
    "first-request": null,
  };
}

export type SetupStatusRow = {
  id: "token" | "runner" | "projects" | "connected";
  variant: DotVariant;
  /** The StatusDot's accessible label. */
  stateLabel: string;
  title: string;
  /** Text with `backticks` for inline code. */
  body: string;
  stepId: SetupStepId;
};

const DOT_LABEL: Readonly<Record<DotVariant, string>> = { success: "Done", warning: "To do", error: "Problem", accent: "In progress", neutral: "Not checked" };

function row(id: SetupStatusRow["id"], variant: DotVariant, title: string, body: string, stepId: SetupStepId): SetupStatusRow {
  return { id, variant, stateLabel: DOT_LABEL[variant], title, body, stepId };
}

function tokenRow({ token, tokenFile }: SuperagentSetupLoad): SetupStatusRow {
  if (token.kind === "found") {
    if (token.isPrivate === false) {
      return row("token", "warning", "Runner token found, but other users can read it", "Run `npm run setup` again in `~/src/tessera-agents`. It makes the file owner-only.", "runner");
    }
    return row("token", "success", "Runner token found", `Tessera reads it from \`${tokenFile}\`.`, "runner");
  }
  if (token.kind === "missing") return row("token", "warning", "No runner token yet", `The runner's setup creates \`${tokenFile}\`.`, "runner");
  return row("token", "error", "Token file unreadable", `Tessera cannot read \`${tokenFile}\` (${token.message}).`, "runner");
}

const STATUS_VARIANT = { info: "neutral", warning: "warning", error: "error" } as const;

function runnerRow({ state, runnerUrl, tokenFile }: SuperagentSetupLoad): SetupStatusRow {
  if (state === null) return row("runner", "neutral", "Runner not checked", "Tessera checks the runner once it can read the token file.", "start");
  if (state.ok) return healthRow(state.data, runnerUrl);
  const context: FailureContext = { tokenFile, runnerUrl };
  switch (state.failure.state) {
    case "unreachable":
      return row("runner", "warning", "Runner not answering", `Nothing answers at \`${runnerUrl}\`. Start the runner. If it stops again, run \`npm run doctor\`: a failed setup check stops it.`, "start");
    case "timeout":
      return row("runner", "warning", "Runner timed out", `The runner at \`${runnerUrl}\` did not answer within 5 seconds.`, "start");
    case "unauthorized":
      return row("runner", "error", "Token rejected", `The runner does not accept the token in \`${tokenFile}\`. Restart the runner. If Tessera reads another file, see step 9.`, "connect");
    default: {
      const copy = failureCopy(state.failure, context);
      return row("runner", STATUS_VARIANT[copy.status], copy.title, copy.body, "start");
    }
  }
}

function healthRow(data: RunnerState, runnerUrl: string): SetupStatusRow {
  const { status, checks } = data.health;
  if (status === "ok") return row("runner", "success", "Runner running and healthy", `It answers at \`${runnerUrl}\`.`, "start");
  const failed = checks.find((check) => !check.ok);
  const stepId = (failed ? stepForCheck(failed.name) : null) ?? "start";
  return status === "degraded"
    ? row("runner", "warning", "Runner running, but a check fails", setupFailedBody(checks), stepId)
    : row("runner", "error", "Runner setup failed", setupFailedBody(checks), stepId);
}

function projectsRow({ mappedProjects }: SuperagentSetupLoad): SetupStatusRow {
  const n = mappedProjects.length;
  if (n === 0) return row("projects", "warning", "No project mapped yet", "Map a project to a repository on the control screen.", "connect");
  return row("projects", "success", n === 1 ? "1 project mapped" : `${n} projects mapped`, mappedProjects.map((project) => `${project.name}: \`${project.repo}\``).join("; "), "connect");
}

function connectedRow({ isConnected }: SuperagentSetupLoad): SetupStatusRow {
  return isConnected
    ? row("connected", "success", "The superagent has connected to Tessera", "Send to superagent and new chats work in mapped projects.", "start")
    : row("connected", "neutral", "The superagent hasn't connected to Tessera yet", "It connects once the runner runs and reaches Tessera at the address in step 9.", "start");
}

export function setupStatusRows(load: SuperagentSetupLoad): SetupStatusRow[] {
  return [tokenRow(load), runnerRow(load), projectsRow(load), connectedRow(load)];
}

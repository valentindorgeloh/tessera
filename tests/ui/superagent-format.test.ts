/**
 * The pure helpers behind the Superagent screen (decision 152; docs/contracts/ui.md
 * "Superagent control", "Shared helpers"): money, stage variants and order,
 * actions, the words of every runner failure, and the small texts of the
 * sections. The fixtures are the same files the fake runner serves.
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  HEALTH_LABEL,
  STAGE_ORDER,
  actionFailureText,
  actionVerb,
  escalationsLabel,
  eventsNewestFirst,
  failureCopy,
  failureToast,
  formatUsd,
  healthVariant,
  intakeSummary,
  modelsLabel,
  parseRequestId,
  parseScope,
  pausedBody,
  prLabel,
  primaryAction,
  reviewRateLabel,
  rewoundBody,
  sectionNote,
  setupFailedBody,
  sizeLabel,
  sortRequests,
  spendVariant,
  stageVariant,
  superagentHref,
  teamRepos,
  triageSummary,
  usdOf,
  type FailureContext,
} from "@/components/superagent/superagent-format";
import { RUNNER_ACTIONS, STAGE_KINDS, RequestsEnvelopeSchema } from "@/lib/superagent/schemas";
import { RUNNER_FAILURE_STATES, type RunnerAction, type RunnerFailure, type RunnerFailureState, type StageKind } from "@/lib/superagent/types";
import type { AgentSettings } from "@/lib/tessera/types";
import { fixture } from "../superagent/support";

const CTX: FailureContext = { tokenFile: "/Users/me/.tessera-agents/api-token", runnerUrl: "http://127.0.0.1:3090" };

function failure(state: RunnerFailureState, message = "The runner said so.", status: number | null = null): RunnerFailure {
  return { state, message, status, code: null };
}

function row(id: string, kind: StageKind, updatedAt: string) {
  return { id, stage: { kind, label: kind, reason: null }, updatedAt };
}

describe("formatUsd", () => {
  it("writes two decimals in en-US", () => {
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(12)).toBe("$12.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.005)).toBe("$0.01");
    expect(formatUsd(3.999)).toBe("$4.00");
  });

  it("joins an amount and its limit", () => {
    expect(usdOf(0.84, 6)).toBe("$0.84 of $6.00");
  });
});

describe("stageVariant", () => {
  it("maps every stage kind: failed is an error, other needs-you stages warn, working accents, done succeeds", () => {
    const expected: Record<StageKind, string> = {
      needs_delivery: "warning",
      needs_question: "warning",
      needs_signoff: "warning",
      needs_hold: "warning",
      needs_review: "warning",
      needs_blocked: "warning",
      needs_failed: "error",
      paused: "neutral",
      queued: "neutral",
      working: "accent",
      done: "success",
      dropped: "neutral",
      stopped: "neutral",
    };
    expect(Object.keys(expected).sort()).toEqual([...STAGE_KINDS].sort());
    for (const kind of STAGE_KINDS) expect(stageVariant(kind), kind).toBe(expected[kind]);
  });
});

describe("sortRequests", () => {
  it("lists every stage kind once, in the contract's order", () => {
    expect([...STAGE_ORDER].sort()).toEqual([...STAGE_KINDS].sort());
    expect(STAGE_ORDER).toEqual([
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
    ]);
  });

  it("orders by stage, then newest update first", () => {
    const rows = [
      row("done-old", "done", "2026-11-01T00:00:00.000Z"),
      row("working", "working", "2026-11-09T10:00:00.000Z"),
      row("signoff-old", "needs_signoff", "2026-11-09T08:00:00.000Z"),
      row("stopped", "stopped", "2026-11-09T11:00:00.000Z"),
      row("signoff-new", "needs_signoff", "2026-11-09T09:00:00.000Z"),
      row("failed", "needs_failed", "2026-11-09T07:00:00.000Z"),
      row("done-new", "done", "2026-11-08T00:00:00.000Z"),
    ];
    expect(sortRequests(rows).map((entry) => entry.id)).toEqual(["signoff-new", "signoff-old", "failed", "working", "done-new", "done-old", "stopped"]);
  });

  it("keeps rows that tie in their order and never mutates its input", () => {
    const at = "2026-11-09T09:00:00.000Z";
    const rows = [row("b", "queued", at), row("a", "queued", at), row("c", "needs_hold", at)];
    const snapshot = rows.map((entry) => entry.id);
    const sorted = sortRequests(rows);
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    expect(rows.map((entry) => entry.id)).toEqual(snapshot);
    expect(sorted).not.toBe(rows);
    expect(sortRequests([])).toEqual([]);
  });

  it("compares times by instant, not by text", () => {
    const rows = [row("early", "queued", "2026-11-09T10:00:00+02:00"), row("late", "queued", "2026-11-09T09:00:00Z")];
    expect(sortRequests(rows).map((entry) => entry.id)).toEqual(["late", "early"]);
  });

  it("sorts the fixture so what needs the user comes first and finished work last", () => {
    const requests = RequestsEnvelopeSchema.parse(fixture("requests")).requests;
    const kinds = sortRequests(requests).map((entry) => entry.stage.kind);
    expect(kinds.map((kind) => STAGE_ORDER.indexOf(kind))).toEqual([...kinds.map((kind) => STAGE_ORDER.indexOf(kind))].sort((a, b) => a - b));
    expect(kinds[0]).toBe("needs_delivery");
    expect(kinds.at(-1)).toBe("stopped");
  });
});

describe("actions", () => {
  it("labels every action as the contract words it", () => {
    expect(ACTION_LABELS).toEqual({
      approve: "Approve",
      retry: "Retry",
      stop: "Stop…",
      resize: "Resize…",
      budget: "Budget…",
      lift_hold: "Lift hold",
      withdraw: "Withdraw",
    });
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...RUNNER_ACTIONS].sort());
  });

  it("drops the ellipsis of a dialog row in a Toast", () => {
    expect(actionVerb("stop")).toBe("Stop");
    expect(actionVerb("lift_hold")).toBe("Lift hold");
    expect(actionVerb("approve")).toBe("Approve");
  });

  it("picks the first of approve, lift hold and retry that is listed", () => {
    expect(primaryAction(["stop", "resize", "approve"])).toBe("approve");
    expect(primaryAction(["lift_hold", "stop"])).toBe("lift_hold");
    expect(primaryAction(["retry", "resize", "stop"])).toBe("retry");
    expect(primaryAction(["retry", "lift_hold", "approve"])).toBe("approve");
    expect(primaryAction(["retry", "lift_hold"])).toBe("lift_hold");
    expect(primaryAction(["budget", "resize", "stop"])).toBeNull();
    expect(primaryAction([])).toBeNull();
  });

  it("gives each fixture request the button the stage calls for", () => {
    const requests = RequestsEnvelopeSchema.parse(fixture("requests")).requests;
    const byStage = new Map(requests.map((entry) => [entry.stage.kind, primaryAction(entry.actions)]));
    expect(byStage.get("needs_signoff")).toBe("approve");
    expect(byStage.get("needs_hold")).toBe("lift_hold");
    expect(byStage.get("needs_failed")).toBe("retry");
    expect(byStage.get("needs_blocked")).toBeNull();
    expect(byStage.get("done")).toBeNull();
  });

  it("words what a failed action was trying to do, for every action", () => {
    const expected: Record<RunnerAction, string> = {
      approve: "Could not approve TES-1",
      retry: "Could not retry TES-1",
      stop: "Could not stop TES-1",
      resize: "Could not resize TES-1",
      budget: "Could not change the budget of TES-1",
      lift_hold: "Could not lift the hold on TES-1",
      withdraw: "Could not withdraw the failed delivery of TES-1",
    };
    for (const action of RUNNER_ACTIONS) expect(actionFailureText(action, "TES-1"), action).toBe(expected[action]);
  });
});

describe("failureCopy", () => {
  it("words every failure state as the contract does", () => {
    expect(failureCopy(failure("not_set_up", "No runner token file"), CTX)).toEqual({
      status: "info",
      title: "Runner not set up",
      body: "Tessera reads the runner's token from /Users/me/.tessera-agents/api-token. Start the superagent runner once to create it.",
    });
    expect(failureCopy(failure("token_unreadable", "EACCES"), CTX)).toEqual({
      status: "error",
      title: "Token file unreadable",
      body: "Tessera cannot read /Users/me/.tessera-agents/api-token (EACCES).",
    });
    expect(failureCopy(failure("unreachable"), CTX)).toEqual({
      status: "warning",
      title: "Runner not answering",
      body: "Nothing answers at http://127.0.0.1:3090. Check that the runner is running.",
    });
    expect(failureCopy(failure("timeout"), CTX)).toEqual({
      status: "warning",
      title: "Runner timed out",
      body: "The runner at http://127.0.0.1:3090 did not answer within 5 seconds.",
    });
    expect(failureCopy(failure("unauthorized"), CTX)).toEqual({
      status: "error",
      title: "Token rejected",
      body: "The runner rejected Tessera's token. Restart the runner or check /Users/me/.tessera-agents/api-token.",
    });
    expect(failureCopy(failure("forbidden", "Origin refused"), CTX)).toEqual({ status: "error", title: "Request refused", body: "Origin refused" });
    expect(failureCopy(failure("not_found", "No such request"), CTX)).toEqual({ status: "warning", title: "Not found", body: "No such request" });
    expect(failureCopy(failure("validation", "size must be S, M or L"), CTX)).toEqual({ status: "error", title: "Not accepted", body: "size must be S, M or L" });
    expect(failureCopy(failure("conflict", "stale revision"), CTX)).toEqual({ status: "warning", title: "Changed elsewhere", body: "The latest values are loaded." });
    expect(failureCopy(failure("unavailable", "Starting up"), CTX)).toEqual({ status: "warning", title: "Runner unavailable", body: "Starting up" });
    expect(failureCopy(failure("bad_response", "requests.0.size: Invalid option"), CTX)).toEqual({
      status: "error",
      title: "Unexpected answer",
      body: "The runner's answer does not match the API contract (v1): requests.0.size: Invalid option",
    });
    expect(failureCopy(failure("http_error", "Boom", 500), CTX)).toEqual({ status: "error", title: "Runner error", body: "The runner answered 500: Boom" });
  });

  it("covers every failure state with a title and a body", () => {
    for (const state of RUNNER_FAILURE_STATES) {
      const copy = failureCopy(failure(state, "msg", 500), CTX);
      expect(copy.title, state).not.toBe("");
      expect(copy.body, state).not.toBe("");
    }
  });

  it("does not claim a status the runner never sent", () => {
    expect(failureCopy(failure("http_error", "Boom", null), CTX).body).toBe("The runner answered with an error: Boom");
  });

  it("puts what was tried in front of the failure's words in a Toast", () => {
    const copy = failureCopy(failure("unreachable"), CTX);
    expect(failureToast("Could not approve TES-142", copy)).toBe(
      "Could not approve TES-142. Runner not answering. Nothing answers at http://127.0.0.1:3090. Check that the runner is running.",
    );
  });
});

describe("sectionNote", () => {
  const ok = { ok: true as const, data: 1 };
  it("says nothing while both loads worked", () => {
    expect(sectionNote(ok, ok, CTX)).toBeNull();
  });

  it("names the failure's title when only the part failed", () => {
    expect(sectionNote(ok, { ok: false, failure: failure("timeout") }, CTX)).toBe("Runner timed out");
  });

  it("says Not available when the state failed, whatever the part says", () => {
    const down = { ok: false as const, failure: failure("not_set_up") };
    expect(sectionNote(down, down, CTX)).toBe("Not available: Runner not set up.");
    expect(sectionNote(down, ok, CTX)).toBe("Not available: Runner not set up.");
  });
});

describe("the screen's URL", () => {
  it("reads the scope and falls back to open", () => {
    expect(parseScope(undefined)).toBe("open");
    expect(parseScope("open")).toBe("open");
    expect(parseScope("recent")).toBe("recent");
    expect(parseScope("all")).toBe("all");
    expect(parseScope("everything")).toBe("open");
    expect(parseScope(["recent", "all"])).toBe("recent");
    expect(parseScope([])).toBe("open");
  });

  it("reads one request id of 1 to 200 characters", () => {
    expect(parseRequestId("rq_signoff")).toBe("rq_signoff");
    expect(parseRequestId(["rq_a", "rq_b"])).toBe("rq_a");
    expect(parseRequestId("")).toBeNull();
    expect(parseRequestId(undefined)).toBeNull();
    expect(parseRequestId("x".repeat(201))).toBeNull();
    expect(parseRequestId("x".repeat(200))).toBe("x".repeat(200));
  });

  it("builds the scope and selection into the query", () => {
    expect(superagentHref("open", null)).toBe("/agents/superagent?scope=open");
    expect(superagentHref("recent", "rq_1")).toBe("/agents/superagent?scope=recent&request=rq_1");
    expect(superagentHref("all", "a b/c")).toBe("/agents/superagent?scope=all&request=a+b%2Fc");
  });
});

describe("request cells", () => {
  it("adds the deliverable to the size when it is not a pull request", () => {
    expect(sizeLabel("M", "pr")).toBe("M");
    expect(sizeLabel("S", "answer")).toBe("S · answer");
    expect(sizeLabel("L", "investigation")).toBe("L · investigation");
  });

  it("writes a pull request as number and state", () => {
    expect(prLabel({ number: 214, url: "https://example.com/pull/214", state: "open" })).toBe("#214 open"); // hex-ok: a pull request number
    expect(prLabel({ number: 7, url: "https://example.com/pull/7", state: "merged" })).toBe("#7 merged"); // hex-ok: a pull request number
  });

  it("lists the models, or None yet", () => {
    expect(modelsLabel(["opus", "sonnet"])).toBe("opus, sonnet");
    expect(modelsLabel([])).toBe("None yet");
  });
});

describe("health and spend", () => {
  it("labels and colours the three health states", () => {
    expect(HEALTH_LABEL).toEqual({ ok: "Healthy", degraded: "Degraded", setup_failed: "Setup failed" });
    expect(healthVariant("ok")).toBe("success");
    expect(healthVariant("degraded")).toBe("warning");
    expect(healthVariant("setup_failed")).toBe("error");
  });

  it("turns the spend bar to warning from 80% of the cap and error from 100%", () => {
    expect(spendVariant(0, 20)).toBe("accent");
    expect(spendVariant(15.99, 20)).toBe("accent");
    expect(spendVariant(16, 20)).toBe("warning");
    expect(spendVariant(19.99, 20)).toBe("warning");
    expect(spendVariant(20, 20)).toBe("error");
    expect(spendVariant(25, 20)).toBe("error");
    expect(spendVariant(5, 0)).toBe("accent");
  });

  it("words the banners", () => {
    expect(pausedBody("manual")).toBe("Paused by you.");
    expect(pausedBody("daily_cap")).toBe("The daily cap is reached; new work waits until tomorrow.");
    expect(pausedBody(null)).toBe("Paused by you.");
    expect(rewoundBody(500, 412)).toBe(
      "The runner's cursor (500) is past Tessera's newest change (412), as after a restore. Intake stays stopped until the runner is reset.",
    );
  });

  it("names the failed checks of a failed setup", () => {
    expect(
      setupFailedBody([
        { name: "GitHub CLI signed in", ok: true, detail: null },
        { name: "Clone of tessera", ok: false, detail: "not a git repository" },
        { name: "Tessera MCP reachable", ok: false, detail: null },
      ]),
    ).toBe("Failed checks: Clone of tessera (not a git repository); Tessera MCP reachable.");
    expect(setupFailedBody([{ name: "a", ok: true, detail: null }])).toBe("The runner reports that its setup failed.");
  });

  it("summarises triage and intake", () => {
    const row = (status: "queued" | "running" | "decided" | "unavailable") => ({ id: status, itemKey: "TES-1", status, attempts: 0, lastError: null, updatedAt: "2026-11-09T09:00:00.000Z" });
    expect(triageSummary([row("queued"), row("queued"), row("running"), row("unavailable"), row("decided")])).toBe("2 queued, 1 running");
    expect(triageSummary([])).toBe("0 queued, 0 running");
    expect(intakeSummary({ rewound: false, cursor: 412, latestSeq: 415 })).toBe("cursor 412, Tessera at 415");
  });
});

describe("routing texts", () => {
  it("writes the first-pass review rate as a percent", () => {
    expect(reviewRateLabel(0.64)).toBe("64%");
    expect(reviewRateLabel(0)).toBe("0%");
    expect(reviewRateLabel(1)).toBe("100%");
    expect(reviewRateLabel(null)).toBe("No reviews yet");
  });

  it("joins the escalations, or None", () => {
    expect(escalationsLabel([{ cause: "review_failed", count: 3 }, { cause: "tests_failed", count: 2 }])).toBe("review_failed: 3, tests_failed: 2");
    expect(escalationsLabel([])).toBe("None");
  });
});

describe("eventsNewestFirst", () => {
  it("sorts a copy newest first and leaves the oldest-first prop alone", () => {
    const events = [
      { at: "2026-11-09T09:03:00.000Z", kind: "created", text: "a" },
      { at: "2026-11-09T09:21:00.000Z", kind: "comment", text: "c" },
      { at: "2026-11-09T09:05:00.000Z", kind: "triage", text: "b" },
    ];
    expect(eventsNewestFirst(events).map((event) => event.text)).toEqual(["c", "b", "a"]);
    expect(events.map((event) => event.text)).toEqual(["a", "c", "b"]);
  });
});

describe("teamRepos", () => {
  const agents: AgentSettings = {
    runner_url: "http://127.0.0.1:3090",
    projects: [
      { project_id: "p1", repo: "tessera" },
      { project_id: "p2", repo: "acme/web" },
      { project_id: "p3", repo: "tessera" },
    ],
  };
  const doc = (repos: string[]) => ({ ok: true as const, data: { teamSections: repos.map((repo) => ({ repo, section: "scope" as const, text: "t" })), revision: 1 } });

  it("merges mapped repositories with those already in teamSections, without duplicates, sorted", () => {
    expect(teamRepos(agents, doc(["zeta", "acme/web", "alpha"]))).toEqual(["acme/web", "alpha", "tessera", "zeta"]);
  });

  it("uses the mapped ones alone while the prompts did not load, and nothing without either", () => {
    expect(teamRepos(agents, { ok: false, failure: failure("timeout") })).toEqual(["acme/web", "tessera"]);
    expect(teamRepos(null, { ok: false, failure: failure("timeout") })).toEqual([]);
    expect(teamRepos(null, doc(["b", "a"]))).toEqual(["a", "b"]);
  });
});

/**
 * The setup guide's content and status rules (decision 155; src/components/superagent/setup-guide.ts and
 * setup-status.ts): every command is one line, every config fragment is valid JSON once filled, the text names
 * no person or repository, every doctor check maps to a step, and the status rows and step states follow the
 * token file, the runner's answer, the mapped projects and the superagent's connection.
 */
import { describe, expect, it } from "vitest";
import {
  DOCTOR_CHECKS,
  DOCTOR_EXIT_CODES,
  GUIDE_INTRO,
  OTHER_PROBLEMS,
  RUNNER_REPOSITORY,
  SETUP_STEPS,
  STATUS_NOTE,
  TROUBLESHOOTING_INTRO,
  fillGuideText,
  splitInlineCode,
  type SetupStepId,
} from "@/components/superagent/setup-guide";
import { setupStatusRows, stepAnchor, stepForCheck, stepLinkLabel, stepNumber, stepStates, tesseraUrlFromHost } from "@/components/superagent/setup-status";
import type { RunnerFailureState, RunnerResult, RunnerState, SuperagentSetupLoad } from "@/lib/superagent/types";
import { fixture } from "../superagent/support";

const STEP_IDS: SetupStepId[] = ["before", "runner", "api-key", "agent-account", "agent-token", "agent-login", "agent-identity", "repos", "access", "connect", "start", "first-request"];
const FILLS = [{ tesseraUrl: null }, { tesseraUrl: "http://127.0.0.1:3000" }];
const RUNNER_CHECKS = ["config", "node", "agent account", "your account", "api key", "api token", "gitconfig", "gh-agent login", "repo my-app", "sandbox", "disk", "tessera", "github"];

/** Every text of the guide, as the personal-data and step-number checks read it. */
function allText(): string {
  return JSON.stringify({ SETUP_STEPS, DOCTOR_CHECKS, DOCTOR_EXIT_CODES, OTHER_PROBLEMS, GUIDE_INTRO, STATUS_NOTE, TROUBLESHOOTING_INTRO });
}

describe("the steps", () => {
  it("are the 12 of the guide, in order, each with why, actions and a done-when", () => {
    expect(SETUP_STEPS).toHaveLength(12);
    expect(SETUP_STEPS.map((step) => step.id)).toEqual(STEP_IDS);
    expect(new Set(SETUP_STEPS.map((step) => step.id)).size).toBe(12);
    expect(SETUP_STEPS[0].id).toBe("before");
    expect(SETUP_STEPS[11].id).toBe("first-request");
    for (const step of SETUP_STEPS) {
      expect(step.why.trim(), step.id).not.toBe("");
      expect(step.actions.length, step.id).toBeGreaterThan(0);
      expect(step.doneWhen.trim(), step.id).not.toBe("");
    }
  });

  it("keep every command on one line, filled either way", () => {
    const commands = [...SETUP_STEPS.flatMap((step) => step.actions.flatMap((action) => (action.command ? [action.command] : []))), ...OTHER_PROBLEMS.flatMap((problem) => (problem.command ? [problem.command] : []))];
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      for (const context of FILLS) {
        const filled = fillGuideText(command, context);
        expect(filled.trim(), command).not.toBe("");
        expect(filled, command).not.toMatch(/[\r\n]/);
      }
    }
  });

  it("hold config fragments that are valid JSON once filled, with {PORT} left alone", () => {
    const examples = SETUP_STEPS.flatMap((step) => step.actions.flatMap((action) => (action.example ? [{ step: step.id, example: action.example }] : [])));
    expect(examples.length).toBeGreaterThanOrEqual(4);
    for (const { step, example } of examples) {
      for (const context of FILLS) expect(() => JSON.parse(`{${fillGuideText(example, context)}}`), step).not.toThrow();
    }
    const withPort = examples.filter(({ example }) => example.includes("{PORT}"));
    expect(withPort.length).toBeGreaterThan(0);
    for (const { example } of withPort) expect(fillGuideText(example, FILLS[1])).toContain("{PORT}");
    const connect = SETUP_STEPS.find((step) => step.id === "connect")?.actions.find((action) => action.example)?.example ?? "";
    expect(fillGuideText(connect, { tesseraUrl: "http://127.0.0.1:3000" })).toContain('"mcpUrl": "http://127.0.0.1:3000/api/mcp"');
    expect(fillGuideText(connect, { tesseraUrl: null })).toContain("http://127.0.0.1:<port>/api/mcp");
  });

  it("leave no placeholder of the fill unfilled, and clone the runner from the placeholder while it has no address", () => {
    expect(RUNNER_REPOSITORY.url).toBeNull();
    for (const context of FILLS) {
      const filled = fillGuideText(allText(), context);
      expect(filled).not.toContain("{tessera}");
      expect(filled).not.toContain("{runner-repo}");
    }
    const clone = SETUP_STEPS.find((step) => step.id === "runner")?.actions[0].command ?? "";
    expect(fillGuideText(clone, { tesseraUrl: null })).toBe("git clone <tessera-agents-url> ~/src/tessera-agents");
  });

  it("name no person, account, repository or address of anyone", () => {
    const text = allText();
    expect(text).not.toMatch(/valentin|dorgeloh|portfolio|jiggle|vr-world|agents-sandbox/i);
    for (const match of text.matchAll(/\/Users\/(.{0,6})/g)) expect(match[1], match[0]).toMatch(/^<you>/);
    for (const match of text.matchAll(/\S+@\S+\.\w+/g)) expect(match[0], match[0]).toContain("<you>");
    for (const match of text.matchAll(/github\.com\/(.{0,15})/g)) expect(match[1], match[0]).toMatch(/^(settings\/tokens|signup|<)/);
  });

  it("only point at steps 1 to 11", () => {
    const numbers = [...allText().matchAll(/step (\d+)/gi)].map((match) => Number(match[1]));
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(11);
    }
  });
});

describe("the doctor checks", () => {
  it("map every check the runner prints to a step of the guide", () => {
    for (const name of RUNNER_CHECKS) {
      const step = stepForCheck(name);
      expect(step, name).not.toBeNull();
      expect(STEP_IDS, name).toContain(step);
    }
    expect(stepForCheck("repo my-app")).toBe("repos");
    expect(stepForCheck("github")).toBe("agent-login");
    expect(stepForCheck("tessera")).toBe("connect");
  });

  it("list intake with exit code 2 and no step, and know no other name", () => {
    expect(stepForCheck("intake")).toBeNull();
    expect(stepForCheck("unknown")).toBeNull();
    expect(DOCTOR_CHECKS.find((check) => check.name === "intake")?.exitCode).toBe(2);
  });

  it("list exit codes 0 to 3 and point only at steps that exist", () => {
    expect(DOCTOR_EXIT_CODES.map((entry) => entry.code)).toEqual([0, 1, 2, 3]);
    for (const { stepId } of [...DOCTOR_CHECKS, ...DOCTOR_EXIT_CODES, ...OTHER_PROBLEMS]) {
      if (stepId !== null) expect(STEP_IDS).toContain(stepId);
    }
  });
});

describe("splitInlineCode", () => {
  it("splits at backtick pairs", () => {
    expect(splitInlineCode("plain text")).toEqual([{ value: "plain text", isCode: false }]);
    expect(splitInlineCode("a `b` c")).toEqual([
      { value: "a ", isCode: false },
      { value: "b", isCode: true },
      { value: " c", isCode: false },
    ]);
    expect(splitInlineCode("`a` and `b`")).toEqual([
      { value: "a", isCode: true },
      { value: " and ", isCode: false },
      { value: "b", isCode: true },
    ]);
  });

  it("keeps an unmatched backtick as text and drops empty parts", () => {
    expect(splitInlineCode("a `b")).toEqual([{ value: "a `b", isCode: false }]);
    expect(splitInlineCode("a `b` `c")).toEqual([
      { value: "a ", isCode: false },
      { value: "b", isCode: true },
      { value: " `c", isCode: false },
    ]);
    expect(splitInlineCode("")).toEqual([]);
    expect(splitInlineCode("`a`")).toEqual([{ value: "a", isCode: true }]);
  });
});

describe("tesseraUrlFromHost", () => {
  it("gives this Tessera's address on 127.0.0.1 from a host with a port", () => {
    expect(tesseraUrlFromHost("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(tesseraUrlFromHost("localhost:3001")).toBe("http://127.0.0.1:3001");
    expect(tesseraUrlFromHost("[::1]:3002")).toBe("http://127.0.0.1:3002");
  });

  it("gives null without a usable port", () => {
    for (const host of [null, "tessera.local", "host:0", "host:70000", "a:b"]) expect(tesseraUrlFromHost(host), String(host)).toBeNull();
  });
});

describe("step numbers and links", () => {
  it("number the steps from 0 and word the links", () => {
    expect(stepNumber("before")).toBe(0);
    expect(stepNumber("first-request")).toBe(11);
    expect(stepLinkLabel("connect")).toBe("Step 9");
    expect(stepLinkLabel("before")).toBe("Before you start");
    expect(stepAnchor("start")).toBe("#setup-step-start");
  });
});

const CHECKS_OK = RUNNER_CHECKS.map((name) => ({ name, ok: true, detail: null }));

function runnerState(health: Partial<RunnerState["health"]> = {}): RunnerState {
  return { ...fixture<RunnerState>("state"), health: { status: "ok", checks: CHECKS_OK, ...health }, intake: { rewound: false, cursor: null, latestSeq: null } };
}

function failed(state: RunnerFailureState, message = "failed"): RunnerResult<never> {
  return { ok: false, failure: { state, message, status: null, code: null } };
}

const WEB = { id: "p1", name: "Web", identifier: "WEB", repo: "web-repo" };

function load(over: Partial<SuperagentSetupLoad> = {}): SuperagentSetupLoad {
  return {
    runnerUrl: "http://127.0.0.1:3090",
    tokenFile: "/Users/me/.tessera-agents/api-token",
    token: { kind: "found", isPrivate: true },
    state: { ok: true, data: runnerState() },
    mappedProjects: [WEB],
    isConnected: true,
    ...over,
  };
}

/** The titles of the four rows, in order. */
const titles = (l: SuperagentSetupLoad) => setupStatusRows(l).map((row) => row.title);

describe("the status rows and step states", () => {
  it("are all green when the runner is healthy, a project is mapped and the superagent connected", () => {
    const l = load();
    expect(titles(l)).toEqual(["Runner token found", "Runner running and healthy", "1 project mapped", "The superagent has connected to Tessera"]);
    expect(setupStatusRows(l).map((row) => row.variant)).toEqual(["success", "success", "success", "success"]);
    expect(setupStatusRows(l)[0].body).toBe("Tessera reads it from `/Users/me/.tessera-agents/api-token`.");
    expect(setupStatusRows(l)[1].body).toBe("It answers at `http://127.0.0.1:3090`.");
    expect(setupStatusRows(l)[2].body).toBe("Web: `web-repo`");
    const states = stepStates(l);
    for (const id of ["runner", "api-key", "agent-account", "agent-token", "agent-login", "agent-identity", "repos", "connect", "start"] as const) expect(states[id], id).toBe("done");
    expect(states.access).toBe("unknown");
    expect(states.before).toBeNull();
    expect(states["first-request"]).toBeNull();
  });

  it("word the state labels of the dots", () => {
    expect(setupStatusRows(load()).map((row) => row.stateLabel)).toEqual(["Done", "Done", "Done", "Done"]);
    expect(setupStatusRows(load({ token: { kind: "unreadable", message: "EACCES" } }))[0].stateLabel).toBe("Problem");
    expect(setupStatusRows(load({ isConnected: false }))[3].stateLabel).toBe("Not checked");
  });

  it("show a missing token as the first thing to do, with nothing else checked", () => {
    const l = load({ token: { kind: "missing" }, state: null, mappedProjects: [], isConnected: false });
    expect(titles(l)).toEqual(["No runner token yet", "Runner not checked", "No project mapped yet", "The superagent hasn't connected to Tessera yet"]);
    expect(setupStatusRows(l).map((row) => row.variant)).toEqual(["warning", "neutral", "warning", "neutral"]);
    const states = stepStates(l);
    expect(states.runner).toBe("todo");
    expect(states["api-key"]).toBe("unknown");
    expect(states.connect).toBe("todo");
    expect(states.start).toBe("unknown");
  });

  it("show an unreadable token as a problem with its error code", () => {
    const l = load({ token: { kind: "unreadable", message: "EACCES" }, state: null });
    const [token, runner] = setupStatusRows(l);
    expect(token).toMatchObject({ variant: "error", title: "Token file unreadable", body: "Tessera cannot read `/Users/me/.tessera-agents/api-token` (EACCES)." });
    expect(runner.title).toBe("Runner not checked");
    expect(stepStates(l).runner).toBe("todo");
  });

  it("warn about a token other users can read", () => {
    const l = load({ token: { kind: "found", isPrivate: false } });
    expect(setupStatusRows(l)[0]).toMatchObject({ variant: "warning", title: "Runner token found, but other users can read it", stepId: "runner" });
    expect(stepStates(l).runner).toBe("todo");
    expect(setupStatusRows(load({ token: { kind: "found", isPrivate: null } }))[0].title).toBe("Runner token found");
  });

  it("show a runner that does not answer as something to start", () => {
    const l = load({ state: failed("unreachable"), isConnected: false });
    expect(setupStatusRows(l)[1]).toMatchObject({
      variant: "warning",
      title: "Runner not answering",
      stepId: "start",
      body: "Nothing answers at `http://127.0.0.1:3090`. Start the runner. If it stops again, run `npm run doctor`: a failed setup check stops it.",
    });
    const states = stepStates(l);
    expect(states.start).toBe("todo");
    expect(states["api-key"]).toBe("unknown");
    expect(states.connect).toBe("unknown");
  });

  it("show a timeout as a warning", () => {
    const l = load({ state: failed("timeout") });
    expect(setupStatusRows(l)[1]).toMatchObject({ variant: "warning", title: "Runner timed out", body: "The runner at `http://127.0.0.1:3090` did not answer within 5 seconds." });
    expect(stepStates(l).start).toBe("todo");
  });

  it("show a rejected token as an error that points at step 9", () => {
    const l = load({ state: failed("unauthorized") });
    expect(setupStatusRows(l)[1]).toMatchObject({ variant: "error", title: "Token rejected", stepId: "connect" });
    expect(setupStatusRows(l)[1].body).toContain("If Tessera reads another file, see step 9.");
    const states = stepStates(l);
    expect(states.connect).toBe("todo");
    // Something answered, so the runner is started.
    expect(states.start).toBe("done");
  });

  it("count a runner that answers in an odd way as running, with its failure words", () => {
    const l = load({ state: failed("bad_response", "intake: expected number") });
    expect(setupStatusRows(l)[1]).toMatchObject({ variant: "error", title: "Unexpected answer" });
    const states = stepStates(l);
    for (const id of ["api-key", "agent-account", "agent-token", "agent-login", "agent-identity", "repos", "start"] as const) expect(states[id], id).toBe("done");
  });

  it("send a failing github check to step 6", () => {
    const checks = CHECKS_OK.map((check) => (check.name === "github" ? { ...check, ok: false, detail: "gh-agent is logged in as x, not y" } : check));
    const l = load({ state: { ok: true, data: runnerState({ status: "degraded", checks }) } });
    expect(setupStatusRows(l)[1]).toMatchObject({
      variant: "warning",
      title: "Runner running, but a check fails",
      stepId: "agent-login",
      body: "Failed checks: github (gh-agent is logged in as x, not y).",
    });
    const states = stepStates(l);
    expect(states["agent-login"]).toBe("todo");
    expect(states["agent-token"]).toBe("done");
    // Step 10 waits for a healthy runner, as its "done when" says.
    expect(states.start).toBe("todo");
  });

  it("send a failing tessera check to step 9", () => {
    const checks = CHECKS_OK.map((check) => (check.name === "tessera" ? { ...check, ok: false, detail: "unreachable" } : check));
    const l = load({ state: { ok: true, data: runnerState({ status: "degraded", checks }) } });
    expect(stepStates(l).connect).toBe("todo");
    expect(setupStatusRows(l)[1].stepId).toBe("connect");
  });

  it("show a failed setup as an error", () => {
    const checks = CHECKS_OK.map((check) => (check.name === "api key" ? { ...check, ok: false, detail: null } : check));
    const l = load({ state: { ok: true, data: runnerState({ status: "setup_failed", checks }) } });
    expect(setupStatusRows(l)[1]).toMatchObject({ variant: "error", title: "Runner setup failed", stepId: "api-key", body: "Failed checks: api key." });
    expect(stepStates(l)["api-key"]).toBe("todo");
  });

  it("fall back to step 10 when a failing check has no step of its own", () => {
    const checks = [{ name: "intake", ok: false, detail: null }];
    const l = load({ state: { ok: true, data: runnerState({ status: "degraded", checks }) } });
    expect(setupStatusRows(l)[1].stepId).toBe("start");
  });

  it("ask for a mapping when none is live", () => {
    const l = load({ mappedProjects: [] });
    expect(setupStatusRows(l)[2]).toMatchObject({ variant: "warning", title: "No project mapped yet", body: "Map a project to a repository on the control screen.", stepId: "connect" });
    expect(stepStates(l).connect).toBe("todo");
  });

  it("list several mapped projects", () => {
    const l = load({ mappedProjects: [WEB, { id: "p2", name: "Api", identifier: "API", repo: "api-repo" }] });
    expect(setupStatusRows(l)[2]).toMatchObject({ title: "2 projects mapped", body: "Web: `web-repo`; Api: `api-repo`" });
  });

  it("leave step 9 unchecked until the superagent has connected", () => {
    const l = load({ isConnected: false });
    expect(setupStatusRows(l)[3]).toMatchObject({ variant: "neutral", title: "The superagent hasn't connected to Tessera yet", stepId: "start" });
    expect(stepStates(l).connect).toBe("unknown");
  });
});

/**
 * The fixtures in tests/fixtures/superagent/ (served by scripts/superagent-stub.ts and read by the client tests)
 * parse with the v1 schemas and cover every stage and action group the Superagent screen draws.
 */
import { describe, expect, it } from "vitest";
import {
  RequestDetailEnvelopeSchema,
  RequestsEnvelopeSchema,
  RunnerPromptsDocSchema,
  RunnerSettingsDocSchema,
  RunnerStateSchema,
  RunnerStatsSchema,
  STAGE_KINDS,
  TriageListEnvelopeSchema,
} from "@/lib/superagent/schemas";
import { fixture } from "./support";

const requests = RequestsEnvelopeSchema.parse(fixture("requests")).requests;
const byStage = (kind: string) => requests.find((request) => request.stage.kind === kind);

describe("fixtures parse", () => {
  it("state, requests, request-detail, stats, triage, settings and prompts match their schemas", () => {
    expect(RunnerStateSchema.safeParse(fixture("state")).success).toBe(true);
    expect(RequestsEnvelopeSchema.safeParse(fixture("requests")).success).toBe(true);
    expect(RequestDetailEnvelopeSchema.safeParse(fixture("request-detail")).success).toBe(true);
    expect(RunnerStatsSchema.safeParse(fixture("stats")).success).toBe(true);
    expect(TriageListEnvelopeSchema.safeParse(fixture("triage")).success).toBe(true);
    expect(RunnerSettingsDocSchema.safeParse(fixture("settings")).success).toBe(true);
    expect(RunnerPromptsDocSchema.safeParse(fixture("prompts")).success).toBe(true);
  });
});

describe("requests fixture coverage", () => {
  it("has a request in every stage, with unique ids and item keys", () => {
    expect(new Set(requests.map((request) => request.stage.kind))).toEqual(new Set(STAGE_KINDS));
    expect(new Set(requests.map((request) => request.id)).size).toBe(requests.length);
    expect(new Set(requests.map((request) => request.itemKey)).size).toBe(requests.length);
  });

  it("lists the actions each stage group needs", () => {
    expect(byStage("needs_signoff")?.actions).toContain("approve");
    expect(byStage("needs_hold")?.actions).toContain("lift_hold");
    expect(byStage("needs_blocked")?.actions).toEqual(expect.arrayContaining(["budget", "resize"]));
    expect(byStage("working")?.actions).toContain("stop");
    expect(byStage("needs_failed")?.actions).toContain("retry");
    for (const kind of ["done", "dropped", "stopped"]) expect(byStage(kind)?.actions).toEqual([]);
  });

  it("has an open PR in review, a merged one when done, and a draft PR when blocked", () => {
    expect(byStage("needs_review")?.pr?.state).toBe("open");
    expect(byStage("done")?.pr?.state).toBe("merged");
    expect(byStage("needs_blocked")?.pr?.state).toBe("draft");
  });

  it("has non-pr deliverables, more than one size and more than one repo", () => {
    expect(new Set(requests.map((request) => request.deliverable))).toEqual(new Set(["pr", "answer", "investigation"]));
    expect(new Set(requests.map((request) => request.size))).toEqual(new Set(["S", "M", "L"]));
    expect(new Set(requests.map((request) => request.repo)).size).toBeGreaterThan(1);
  });

  it("detail fixture is one of the requests, with sessions, events and an open question", () => {
    const { request } = RequestDetailEnvelopeSchema.parse(fixture("request-detail"));
    expect(requests.some((entry) => entry.id === request.id)).toBe(true);
    expect(request.sessions.length).toBeGreaterThan(1);
    expect(request.sessions.some((session) => session.endedAt === null)).toBe(true);
    expect(request.events.length).toBeGreaterThan(1);
    expect(request.question).not.toBeNull();
    expect(request.planPageId).not.toBeNull();
  });

  it("triage fixture has one unavailable and one queued row", () => {
    const { triage } = TriageListEnvelopeSchema.parse(fixture("triage"));
    expect(triage.map((row) => row.status).sort()).toEqual(["queued", "unavailable"]);
    expect(triage.find((row) => row.status === "unavailable")?.lastError).not.toBeNull();
  });

  it("state counts agree with the requests", () => {
    const state = RunnerStateSchema.parse(fixture("state"));
    expect(state.counts.needsYou).toBe(requests.filter((request) => request.stage.kind.startsWith("needs_")).length);
    expect(state.counts.working).toBe(requests.filter((request) => request.stage.kind === "working").length);
    expect(state.counts.queued).toBe(requests.filter((request) => request.stage.kind === "queued").length);
  });
});

describe("schemas", () => {
  it("accept a null first-pass rate and a string revision, the two open spots in the v1 text", () => {
    const stats = { ...fixture<Record<string, unknown>>("stats"), firstPassReviewRate: null };
    expect(RunnerStatsSchema.safeParse(stats).success).toBe(true);
    const settings = { ...fixture<Record<string, unknown>>("settings"), revision: "abc" };
    expect(RunnerSettingsDocSchema.safeParse(settings).success).toBe(true);
    expect(RunnerSettingsDocSchema.safeParse({ ...settings, revision: null }).success).toBe(false);
  });

  it("refuse a null intake cursor and a negative count", () => {
    const state = fixture<{ intake: Record<string, unknown>; slots: Record<string, number> }>("state");
    expect(RunnerStateSchema.safeParse({ ...state, intake: { ...state.intake, cursor: null } }).success).toBe(false);
    expect(RunnerStateSchema.safeParse({ ...state, slots: { running: -1, max: 2 } }).success).toBe(false);
  });
});

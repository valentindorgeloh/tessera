// @vitest-environment jsdom
/**
 * The superagent screen's settings and team-section forms (decisions 144 and
 * 145; docs/contracts/ui.md "Screen /agents/superagent" items 5 and 6): the
 * pure helpers, then both sections rendered with `createElement` (as
 * detail-smoke.test.ts does) with the Server Action wrappers and the Toast
 * hook mocked.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerFailure, RunnerPromptsDoc, RunnerResult, RunnerSettingsDoc } from "@/lib/superagent/types";
import type { AgentSettings } from "@/lib/tessera/types";

const saveSettings = vi.hoisted(() => vi.fn());
const savePrompts = vi.hoisted(() => vi.fn());
const saveMapping = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/superagent", () => ({ superagentSaveSettingsAction: saveSettings, superagentSavePromptsAction: savePrompts }));
vi.mock("@/app/actions/workspace-settings", () => ({ setAgentSettingsAction: saveMapping }));
vi.mock("@astryxdesign/core/Toast", async (importOriginal) => {
  const real = await importOriginal<typeof import("@astryxdesign/core/Toast")>();
  return { ...real, useToast: () => toastSpy };
});

const { AgentSettingsSection } = await import("@/components/superagent/AgentSettingsSection");
const { TeamSectionsSection } = await import("@/components/superagent/TeamSectionsSection");
const format = await import("@/components/superagent/settings-format");

const WEB = "11111111-1111-7111-8111-111111111111";
const API = "22222222-2222-7222-8222-222222222222";
const GONE = "33333333-3333-7333-8333-333333333333";
const projects = [
  { id: WEB, name: "Website", identifier: "WEB" },
  { id: API, name: "Backend", identifier: "API" },
];
const agents: AgentSettings = { runner_url: "http://127.0.0.1:3090", projects: [{ project_id: WEB, repo: "tessera" }] };
const settingsDoc: RunnerSettingsDoc = { settings: { budgetsUsd: { S: 2, M: 6, L: 15 }, dailyCapUsd: 25, maxParallel: 2, signoffM: true }, revision: 7 };
const promptsDoc: RunnerPromptsDoc = {
  teamSections: [
    { repo: "tessera", section: "communication", text: "Be brief." },
    { repo: "other/repo", section: "scope", text: "Docs only." },
  ],
  revision: "r3",
};
const failure = (state: RunnerFailure["state"], message = "boom"): { ok: false; failure: RunnerFailure } => ({ ok: false, failure: { state, message, status: null, code: null } });
const loaded = <T>(data: T): RunnerResult<T> => ({ ok: true, data });

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

/** Types into a React-controlled input or textarea (React listens for the native input event). */
async function type(field: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label) ?? null;
const input = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].find((field) => field.getAttribute("aria-label") === label || field.labels?.[0]?.textContent?.trim().startsWith(label)) ?? null;
async function click(target: HTMLElement | null) {
  await act(async () => {
    target?.click();
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  for (const spy of [saveSettings, savePrompts, saveMapping, toastSpy]) spy.mockReset();
  saveMapping.mockResolvedValue({ ok: true, data: {}, cursor: 1 });
  saveSettings.mockResolvedValue({ ok: true, data: settingsDoc });
  savePrompts.mockResolvedValue({ ok: true, data: promptsDoc });
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe("settings helpers", () => {
  it("accepts only a loopback runner URL, and an empty field", () => {
    for (const url of ["", "  ", "http://127.0.0.1:3391", "http://localhost:3090/", " http://127.0.0.1:3090 "]) expect(format.runnerUrlError(url), url).toBeNull();
    for (const url of ["http://example.com:3391", "https://127.0.0.1:3090", "http://127.0.0.2:3090", "http://127.0.0.1", "127.0.0.1:3090"]) expect(format.runnerUrlError(url), url).toBe(format.RUNNER_URL_ERROR);
  });

  it("requires a repository as name or owner/name", () => {
    expect(format.repoError("")).toBe(format.REPO_REQUIRED);
    expect(format.repoError("   ")).toBe(format.REPO_REQUIRED);
    expect(format.repoError("tessera")).toBeNull();
    expect(format.repoError(" owner/tessera.app-2 ")).toBeNull();
    for (const repo of ["a/b/c", "has space", "owner/", "/name", "naïve"]) expect(format.repoError(repo), repo).toBe(format.REPO_ERROR);
  });

  it("starts with the mapped projects that still exist and counts the dropped ones", () => {
    const stored: AgentSettings = { runner_url: "http://127.0.0.1:3090", projects: [{ project_id: WEB, repo: "tessera" }, { project_id: GONE, repo: "old" }] };
    const { rows, dropped } = format.mappingRows(stored, projects);
    expect(rows).toEqual([{ key: 0, project_id: WEB, repo: "tessera" }]);
    expect(dropped).toBe(1);
    expect(format.mappingRows(null, projects)).toEqual({ rows: [], dropped: 0 });
    expect(format.droppedMappingsText(0)).toBeNull();
    expect(format.droppedMappingsText(1)).toBe("1 mapped project no longer exists and is dropped on save.");
    expect(format.droppedMappingsText(2)).toBe("2 mapped projects no longer exist and are dropped on save.");
  });

  it("builds the set_agent_settings input: the URL only when typed, the repo trimmed", () => {
    const rows = [{ key: 0, project_id: WEB, repo: " tessera " }];
    expect(format.mappingInput("", rows)).toEqual({ projects: [{ project_id: WEB, repo: "tessera" }] });
    expect(format.mappingInput(" http://127.0.0.1:3391 ", rows)).toEqual({ runner_url: "http://127.0.0.1:3391", projects: [{ project_id: WEB, repo: "tessera" }] });
    expect(format.mappingErrors("http://example.com:1", [{ key: 0, project_id: WEB, repo: "" }])).toEqual({ url: format.RUNNER_URL_ERROR, repos: [format.REPO_REQUIRED], any: true });
  });

  it("offers each row its own project and the projects no other row maps", () => {
    const rows = [{ key: 0, project_id: WEB, repo: "a" }];
    expect(format.projectChoices(projects, rows, rows[0]).map((project) => project.id)).toEqual([WEB, API]);
    const both = [...rows, { key: 1, project_id: API, repo: "b" }];
    expect(format.projectChoices(projects, both, both[0]).map((project) => project.id)).toEqual([WEB]);
    expect(format.firstFreeProject(projects, rows)?.id).toBe(API);
    expect(format.firstFreeProject(projects, both)).toBeUndefined();
  });

  it("sends every non-empty text of the shown repos and passes the others through unchanged", () => {
    const stored = promptsDoc.teamSections;
    const edited = format.mergeTeamSections(["tessera"], (repo, section) => (section === "scope" ? "Only src/." : section === "communication" ? "   " : ""), stored);
    expect(edited).toEqual([
      { repo: "other/repo", section: "scope", text: "Docs only." },
      { repo: "tessera", section: "scope", text: "Only src/." },
    ]);
    expect(format.storedTeamText(stored, "tessera", "communication")).toBe("Be brief.");
    expect(format.storedTeamText(stored, "tessera", "delivery")).toBe("");
  });

  it("words a failed save: a stale revision as Changed elsewhere, anything else as an error naming what was tried", () => {
    expect(format.saveFailureToast("Could not save", failure("conflict").failure, "http://127.0.0.1:3090")).toEqual({ type: "info", body: "Changed elsewhere. The latest values are loaded." });
    expect(format.saveFailureToast("Could not save the runner settings", failure("validation", "budget too low").failure, "http://127.0.0.1:3090")).toEqual({
      type: "error",
      body: "Could not save the runner settings. Not accepted. budget too low",
    });
    expect(format.notAvailableText(failure("not_set_up").failure, "http://127.0.0.1:3090")).toBe("Not available: Runner not set up.");
  });
});

describe("AgentSettingsSection", () => {
  const section = (overrides: { agents?: AgentSettings | null; runnerSettings?: RunnerResult<RunnerSettingsDoc> } = {}) =>
    createElement(AgentSettingsSection, { agents: overrides.agents === undefined ? agents : overrides.agents, projects, runnerSettings: overrides.runnerSettings ?? loaded(settingsDoc) });

  it("shows the stored mapping and the runner values", async () => {
    const el = await render(section());
    expect(el.querySelector("h2")?.textContent).toBe("Settings");
    expect(input(el, "Runner URL")?.value).toBe("http://127.0.0.1:3090");
    expect(input(el, "Repository")?.value).toBe("tessera");
    expect(button(el, "Remove Website")).not.toBeNull();
    expect(input(el, "Budget for S (USD)")).not.toBeNull();
    expect(input(el, "Parallel requests")?.value).toBe("2");
    expect(el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  });

  it("shows a field error for a non-loopback URL and sends nothing", async () => {
    const el = await render(section());
    await type(input(el, "Runner URL") as HTMLInputElement, "http://example.com:3391");
    expect(el.textContent).toContain(format.RUNNER_URL_ERROR);
    await click(button(el, "Save mapping"));
    expect(saveMapping).not.toHaveBeenCalled();
  });

  it("saves the URL and the map through setAgentSettingsAction and announces it", async () => {
    const el = await render(section());
    await type(input(el, "Runner URL") as HTMLInputElement, "http://127.0.0.1:3391");
    await type(input(el, "Repository") as HTMLInputElement, "owner/tessera");
    await click(button(el, "Save mapping"));
    expect(saveMapping).toHaveBeenCalledWith({ runner_url: "http://127.0.0.1:3391", projects: [{ project_id: WEB, repo: "owner/tessera" }] });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Mapping saved" });
  });

  it("reports a failed mapping save", async () => {
    saveMapping.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Project not found" });
    const el = await render(section());
    await click(button(el, "Save mapping"));
    expect(toastSpy).toHaveBeenCalledWith({ type: "error", body: "Could not save the mapping. Project not found" });
  });

  it("adds a row for the first free project, asks for its repository and removes rows", async () => {
    const el = await render(section());
    await click(button(el, "Add project"));
    expect(button(el, "Remove Backend")).not.toBeNull();
    // Every project is mapped now.
    expect(button(el, "Add project")?.getAttribute("aria-disabled") ?? button(el, "Add project")?.disabled).toBeTruthy();
    await click(button(el, "Save mapping"));
    expect(saveMapping).not.toHaveBeenCalled();
    expect(el.textContent).toContain(format.REPO_REQUIRED);
    await click(button(el, "Remove Backend"));
    expect(button(el, "Remove Backend")).toBeNull();
    await click(button(el, "Save mapping"));
    expect(saveMapping).toHaveBeenCalledWith({ projects: [{ project_id: WEB, repo: "tessera" }], runner_url: "http://127.0.0.1:3090" });
  });

  it("leaves out a mapping whose project no longer exists and says so", async () => {
    const stored: AgentSettings = { runner_url: "http://127.0.0.1:3090", projects: [{ project_id: GONE, repo: "old" }, { project_id: WEB, repo: "tessera" }] };
    const el = await render(section({ agents: stored }));
    expect(el.textContent).toContain("1 mapped project no longer exists and is dropped on save.");
    expect(el.querySelectorAll('input[placeholder="name or owner/name"]')).toHaveLength(1);
    await click(button(el, "Save mapping"));
    expect(saveMapping).toHaveBeenCalledWith({ runner_url: "http://127.0.0.1:3090", projects: [{ project_id: WEB, repo: "tessera" }] });
  });

  it("works without any stored mapping", async () => {
    const el = await render(section({ agents: null }));
    expect(input(el, "Runner URL")?.value).toBe("");
    expect(input(el, "Runner URL")?.placeholder).toBe("http://127.0.0.1:3090");
    expect(el.textContent).toContain("No project is mapped yet.");
    await click(button(el, "Save mapping"));
    expect(saveMapping).toHaveBeenCalledWith({ projects: [] });
  });

  it("saves the runner settings with the loaded revision", async () => {
    const el = await render(section());
    await click(button(el, "Save runner settings"));
    expect(saveSettings).toHaveBeenCalledWith({ settings: settingsDoc.settings, base_revision: 7 });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Runner settings saved" });
  });

  it("sends the Switch's new value", async () => {
    const el = await render(section());
    await click(el.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await click(button(el, "Save runner settings"));
    expect(saveSettings).toHaveBeenCalledWith({ settings: { ...settingsDoc.settings, signoffM: false }, base_revision: 7 });
  });

  it("answers a conflict with Changed elsewhere and a failure with its title and message", async () => {
    saveSettings.mockResolvedValueOnce(failure("conflict"));
    const el = await render(section());
    await click(button(el, "Save runner settings"));
    expect(toastSpy).toHaveBeenLastCalledWith({ type: "info", body: "Changed elsewhere. The latest values are loaded." });
    saveSettings.mockResolvedValueOnce(failure("validation", "dailyCapUsd must be positive"));
    await click(button(el, "Save runner settings"));
    expect(toastSpy).toHaveBeenLastCalledWith({ type: "error", body: "Could not save the runner settings. Not accepted. dailyCapUsd must be positive" });
  });

  it("replaces the fields when the runner's revision changes", async () => {
    const el = await render(section());
    expect(input(el, "Parallel requests")?.value).toBe("2");
    const next: RunnerSettingsDoc = { settings: { ...settingsDoc.settings, maxParallel: 5 }, revision: 8 };
    await act(async () => {
      root?.render(section({ runnerSettings: loaded(next) }));
    });
    expect(input(el, "Parallel requests")?.value).toBe("5");
  });

  it("disables the runner form with the failure text while its settings failed, and keeps the mapping form working", async () => {
    const el = await render(section({ runnerSettings: failure("not_set_up") }));
    expect(el.textContent).toContain("Not available: Runner not set up.");
    for (const label of ["Budget for S (USD)", "Budget for M (USD)", "Budget for L (USD)", "Daily cap (USD)", "Parallel requests"]) expect(input(el, label)?.disabled, label).toBe(true);
    expect(button(el, "Save runner settings")?.disabled).toBe(true);
    await click(button(el, "Save runner settings"));
    expect(saveSettings).not.toHaveBeenCalled();
    await click(button(el, "Save mapping"));
    expect(saveMapping).toHaveBeenCalledTimes(1);
  });
});

describe("TeamSectionsSection", () => {
  const section = (prompts: RunnerResult<RunnerPromptsDoc>, repos: string[]) => createElement(TeamSectionsSection, { prompts, repos });

  it("shows one collapsible per repository with the three stored texts", async () => {
    const el = await render(section(loaded(promptsDoc), ["other/repo", "tessera"]));
    expect(el.querySelector("h2")?.textContent).toBe("Team sections");
    expect(el.querySelectorAll("textarea")).toHaveLength(6);
    const texts = [...el.querySelectorAll("textarea")].map((area) => area.value);
    expect(texts).toEqual(["", "Docs only.", "", "Be brief.", "", ""]);
    expect(el.textContent).toContain("other/repo");
    expect(el.textContent).toContain("tessera");
  });

  it("sends every non-empty text with the loaded revision, passing unshown repos through", async () => {
    const el = await render(section(loaded(promptsDoc), ["tessera"]));
    const areas = [...el.querySelectorAll("textarea")];
    await type(areas[2] as HTMLTextAreaElement, "Open a draft PR.");
    await type(areas[0] as HTMLTextAreaElement, "");
    await click(button(el, "Save team sections"));
    expect(savePrompts).toHaveBeenCalledWith({
      team_sections: [
        { repo: "other/repo", section: "scope", text: "Docs only." },
        { repo: "tessera", section: "delivery", text: "Open a draft PR." },
      ],
      base_revision: "r3",
    });
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Team sections saved" });
  });

  it("answers a conflict with Changed elsewhere", async () => {
    savePrompts.mockResolvedValueOnce(failure("conflict"));
    const el = await render(section(loaded(promptsDoc), ["tessera"]));
    await click(button(el, "Save team sections"));
    expect(toastSpy).toHaveBeenCalledWith({ type: "info", body: "Changed elsewhere. The latest values are loaded." });
  });

  it("replaces the texts when the revision changes", async () => {
    const el = await render(section(loaded(promptsDoc), ["tessera"]));
    const area = el.querySelector("textarea") as HTMLTextAreaElement;
    await type(area, "Edited");
    expect(el.querySelector("textarea")?.value).toBe("Edited");
    const next: RunnerPromptsDoc = { teamSections: [{ repo: "tessera", section: "communication", text: "Latest." }], revision: "r4" };
    await act(async () => {
      root?.render(section(loaded(next), ["tessera"]));
    });
    expect(el.querySelector("textarea")?.value).toBe("Latest.");
  });

  it("disables the texts and Save with the failure text while the prompts failed", async () => {
    const el = await render(section(failure("unreachable"), ["tessera"]));
    expect(el.textContent).toContain("Not available: Runner not answering.");
    expect([...el.querySelectorAll("textarea")].every((area) => area.disabled)).toBe(true);
    expect(button(el, "Save team sections")?.disabled).toBe(true);
    await click(button(el, "Save team sections"));
    expect(savePrompts).not.toHaveBeenCalled();
  });

  it("asks for a mapped repository when there is none", async () => {
    const el = await render(section(loaded({ teamSections: [], revision: 1 }), []));
    expect(el.textContent).toContain("Map a project to a repository to write its team sections.");
    expect(el.querySelector("textarea")).toBeNull();
  });
});

/**
 * Pure helpers of the superagent settings and team-section forms (decision
 * 144 and 145; docs/contracts/ui.md "Screen /agents/superagent" items 5 and
 * 6). No React and no Astryx, so Vitest reaches them.
 */
import type { RunnerFailure, TeamSection } from "@/lib/superagent/types";
import { AGENT_RUNNER_DEFAULT_URL, AgentRepoSchema, AgentRunnerUrlSchema } from "@/lib/tessera/schemas";
import type { AgentProject, AgentSettings } from "@/lib/tessera/types";
import { failureCopy, failureToast, type FailureContext, type ProjectOption } from "./superagent-format";

// The words name every rule of AgentRunnerUrlSchema and AgentRepoSchema (schema.md "AgentSettings"), so a refused value says why.
export const RUNNER_URL_ERROR = "Use http://127.0.0.1:<port> or http://localhost:<port>, port 1 to 65535.";
export const REPO_ERROR = "Use name or owner/name, up to 140 letters, digits, _, . and -. No part can be . or .. or start with -, and the owner cannot start with a dot.";
export const REPO_REQUIRED = "Enter a repository.";

/** One editable row of the "Projects and repositories" form; `key` is stable while the row is edited. */
export type MappingRow = { key: number; project_id: string; repo: string };

/**
 * The rows the mapping form starts with: the stored entries whose project
 * exists, live or archived (`setAgentSettings` allows an archived project, so
 * its mapping stays and saves unchanged). `dropped` counts the entries whose
 * project is in neither list (deleted), which a save leaves out.
 */
export function mappingRows(agents: AgentSettings | null, projects: readonly ProjectOption[]): { rows: MappingRow[]; dropped: number } {
  const known = new Set(projects.map((project) => project.id));
  const stored = agents?.projects ?? [];
  const kept = stored.filter((entry) => known.has(entry.project_id));
  return { rows: kept.map((entry, index) => ({ key: index, project_id: entry.project_id, repo: entry.repo })), dropped: stored.length - kept.length };
}

/** "1 mapped project no longer exists and is dropped on save.", or null when none is dropped. */
export function droppedMappingsText(dropped: number): string | null {
  if (dropped <= 0) return null;
  return dropped === 1 ? "1 mapped project no longer exists and is dropped on save." : `${dropped} mapped projects no longer exist and are dropped on save.`;
}

/** The runner URL field's error; an empty field is fine (it saves the default URL, as its placeholder says). */
export function runnerUrlError(value: string): string | null {
  const url = value.trim();
  return url === "" || AgentRunnerUrlSchema.safeParse(url).success ? null : RUNNER_URL_ERROR;
}

/** A repository field's error: required, then `name` or `owner/name`. */
export function repoError(value: string): string | null {
  const repo = value.trim();
  if (repo === "") return REPO_REQUIRED;
  return AgentRepoSchema.safeParse(repo).success ? null : REPO_ERROR;
}

/** Every field error of the mapping form, in row order; `null` for a field that is fine. */
export function mappingErrors(url: string, rows: readonly MappingRow[]): { url: string | null; repos: (string | null)[]; any: boolean } {
  const urlProblem = runnerUrlError(url);
  const repos = rows.map((row) => repoError(row.repo));
  return { url: urlProblem, repos, any: urlProblem !== null || repos.some((problem) => problem !== null) };
}

/** The `set_agent_settings` input: the URL (a blank field saves the default, as the placeholder says), the whole map. */
export function mappingInput(url: string, rows: readonly MappingRow[]): { runner_url: string; projects: AgentProject[] } {
  const projects = rows.map((row) => ({ project_id: row.project_id, repo: row.repo.trim() }));
  const runnerUrl = url.trim();
  return { runner_url: runnerUrl === "" ? AGENT_RUNNER_DEFAULT_URL : runnerUrl, projects };
}

/** A project's name in a picker; an archived one says so. */
export function projectLabel(project: ProjectOption): string {
  return project.archived ? `${project.name} (archived)` : project.name;
}

/** The projects a row can pick: its own (even archived) and every live project no other row maps. Archived projects are never offered to another row. */
export function projectChoices(projects: readonly ProjectOption[], rows: readonly MappingRow[], row: MappingRow): ProjectOption[] {
  return projects.filter((project) => project.id === row.project_id || (!project.archived && !rows.some((other) => other.project_id === project.id)));
}

/** The first live project no row maps yet, for "Add project"; undefined when every live project is mapped. */
export function firstFreeProject(projects: readonly ProjectOption[], rows: readonly MappingRow[]): ProjectOption | undefined {
  return projects.find((project) => !project.archived && !rows.some((row) => row.project_id === project.id));
}

/**
 * The Toast after a failed save: a stale revision reads "Changed elsewhere.
 * The latest values are loaded." (the action's `refresh()` loads them, and the
 * form is keyed by the revision); every other failure names what was tried,
 * with the screen's real token path and runner URL.
 */
export function saveFailureToast(what: string, failure: RunnerFailure, context: FailureContext): { type: "info" | "error"; body: string } {
  const copy = failureCopy(failure, context);
  if (failure.state === "conflict") return { type: "info", body: `${copy.title}. ${copy.body}` };
  return { type: "error", body: failureToast(what, copy) };
}

export const TEAM_SECTION_FIELDS = [
  { section: "communication", label: "Communication" },
  { section: "scope", label: "Scope" },
  { section: "delivery", label: "Delivery" },
] as const satisfies readonly { section: TeamSection["section"]; label: string }[];

/** The stored text of one repo and section ("" when there is none; the last entry wins). */
export function storedTeamText(sections: readonly TeamSection[], repo: string, section: TeamSection["section"]): string {
  let text = "";
  for (const entry of sections) if (entry.repo === repo && entry.section === section) text = entry.text;
  return text;
}

/**
 * The `teamSections` a save sends: every non-empty text of the shown repos,
 * and the entries of repos the form does not show, unchanged.
 */
export function mergeTeamSections(repos: readonly string[], textOf: (repo: string, section: TeamSection["section"]) => string, stored: readonly TeamSection[]): TeamSection[] {
  const shown = new Set(repos);
  const untouched = stored.filter((entry) => !shown.has(entry.repo));
  const edited = repos.flatMap((repo) =>
    TEAM_SECTION_FIELDS.map(({ section }) => ({ repo, section, text: textOf(repo, section) })).filter((entry) => entry.text.trim() !== ""),
  );
  return [...untouched, ...edited];
}

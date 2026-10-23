/**
 * Shared pieces of the showcase demo (`npm run db:demo`, scripts/db-demo.ts).
 *
 * The demo is a small travel-planning company ("Orbit") with three active
 * projects and one archived one. Every write goes through the tool registry,
 * as the UI, MCP and the assistant do, so invariants, activity, notifications
 * and search rows are real. One clock steps forward through the past three
 * weeks; it never moves backwards, so activity order and timestamps agree.
 *
 * The anchor items below are created first, in this order, by the core part,
 * so the other parts can refer to them by key (MOB-1 … MOB-8 and so on).
 */
import { ASSISTANT_ACTOR_ID, registerActor, SYSTEM_ACTOR_ID, USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext, type TesseraContext } from "@/lib/tessera/core/context";
import type { DbHandles } from "@/lib/tessera/db/client";
import { runToolWithContext, type ToolInput, type ToolName, type ToolOutput } from "@/lib/tessera/tools/registry";
import type { PaletteColor } from "@/lib/tessera/types";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** How far back the demo story starts. */
export const DEMO_START_DAYS_AGO = 21;

export type DemoClock = {
  /** Moves to `daysAgo` days before the real now at hh:mm local time; a time at or before the current one steps a minute instead. */
  at(daysAgo: number, hour?: number, minute?: number): void;
  /** Moves forward by `minutes` (default 7). */
  step(minutes?: number): void;
  /** The current demo time as an ISO string (the context's `now`). */
  now(): string;
  /** The real "now" the story ends at; parts use it instead of Date.now() so a fixed `now` option stays consistent. */
  readonly base: Date;
};

/** A clock that starts DEMO_START_DAYS_AGO days before `base` and never passes `base` minus one minute. */
export function createDemoClock(base: Date = new Date()): DemoClock {
  const ceiling = base.getTime() - MINUTE;
  let current = base.getTime() - DEMO_START_DAYS_AGO * DAY;
  const moveTo = (target: number) => {
    current = Math.min(ceiling, target > current ? target : current + MINUTE);
  };
  return {
    at(daysAgo, hour = 9, minute = 0) {
      const day = new Date(base.getTime() - daysAgo * DAY);
      day.setHours(hour, minute, 0, 0);
      moveTo(day.getTime());
    },
    step(minutes = 7) {
      moveTo(current + minutes * MINUTE);
    },
    now: () => new Date(current).toISOString(),
    base,
  };
}

/**
 * MCP clients that act in the demo. Each becomes an agent actor with a readable display name (the raw client
 * name stays in `client_name`, so the Agents page still says which MCP client it is).
 */
export const DEMO_AGENTS = {
  release: { client: "release-bot", name: "Release bot", color: "orange" },
  triage: { client: "triage-agent", name: "Triage agent", color: "cyan" },
  coder: { client: "claude-code", name: "Claude Code", color: "purple" },
  docs: { client: "docs-writer", name: "Docs writer", color: "green" },
} as const satisfies Record<string, { client: string; name: string; color: PaletteColor }>;
export type DemoAgent = keyof typeof DEMO_AGENTS;

export type DemoActors = {
  user: TesseraContext;
  assistant: TesseraContext;
  system: TesseraContext;
  agents: Record<DemoAgent, TesseraContext>;
};

/** Contexts for the user, the assistant, the system and the four demo agents, all on the demo clock. */
export function demoActors(handles: DbHandles, clock: DemoClock): DemoActors {
  const base = { db: handles.db, sqlite: handles.sqlite, now: clock.now };
  const system = createContext({ ...base, actorId: SYSTEM_ACTOR_ID });
  const agent = (key: DemoAgent) => {
    const { client, name, color } = DEMO_AGENTS[key];
    const row = registerActor(system, { kind: "agent", name, client_name: client, color });
    return createContext({ ...base, actorId: row.id });
  };
  return {
    user: createContext({ ...base, actorId: USER_ACTOR_ID }),
    assistant: createContext({ ...base, actorId: ASSISTANT_ACTOR_ID }),
    system,
    agents: { release: agent("release"), triage: agent("triage"), coder: agent("coder"), docs: agent("docs") },
  };
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;
/** Which list an item belongs to: the editor keeps bullet, numbered and task lists apart. */
const listKind = (line: string): string => (/^ {0,3}\d+[.)]\s/.test(line) ? "ordered" : /^ {0,3}[-*+]\s+\[[ xX]\]\s/.test(line) ? "task" : "bullet");
const cellsOf = (line: string): string[] => {
  const cells: string[] = [];
  let cell = "";
  const text = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "\\" && text[i + 1] === "|") { cell += "\\|"; i++; } else if (ch === "|") { cells.push(cell.trim()); cell = ""; } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
};

/** A table the way the editor writes it: padded cells, dashes as wide as the column, a blank line more on each side. */
function tableBlock(lines: string[]): string {
  const rows = lines.map(cellsOf).filter((cells) => !cells.every((c) => /^:?-{1,}:?$/.test(c)));
  const width = Math.max(...rows.map((r) => r.length));
  const sizes = Array.from({ length: width }, (_, i) => Math.max(3, ...rows.map((r) => [...(r[i] ?? "")].length)));
  const line = (r: string[]) => `| ${sizes.map((n, i) => (r[i] ?? "").padEnd(n)).join(" | ")} |`;
  const [head, ...body] = rows;
  return `\n${[line(head ?? []), `| ${sizes.map((n) => "-".repeat(n)).join(" | ")} |`, ...body.map(line)].join("\n")}\n`;
}

/**
 * Brings Markdown into the form the description editor writes back, so the demo never opens with the
 * "uses Markdown the editor would rewrite" banner: a blank line between blocks (a heading, a list, a table or a
 * fence after a paragraph), tight lists, padded tables and backticks instead of acute accents (U+00B4).
 */
export function canon(markdown: string): string {
  const lines = markdown.replaceAll("\u00b4", "`").replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  const startsBlock = (l: string) => FENCE_OPEN.test(l) || /^#{1,6}\s/.test(l) || LIST_ITEM.test(l) || /^\s*\|/.test(l);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? "";
    if (line.trim() === "") { i++; continue; }
    const fence = FENCE_OPEN.exec(line)?.[1];
    if (fence) {
      const out = [line];
      for (i++; i < lines.length; i++) {
        out.push(lines[i] ?? "");
        if ((lines[i] ?? "").trim().startsWith(fence)) { i++; break; }
      }
      blocks.push(out.join("\n"));
    } else if (/^#{1,6}\s/.test(line)) { blocks.push(line.trim()); i++; }
    else if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i] ?? ""); i++) rows.push(lines[i] ?? "");
      blocks.push(tableBlock(rows));
    } else if (LIST_ITEM.test(line)) {
      const out: string[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i] ?? "";
        if (l.trim() === "") {
          const next = lines.slice(i + 1).find((x) => x.trim() !== "");
          const last = [...out].reverse().find((x) => !/^ {2,}\S/.test(x));
          // Another item of the same kind (or an indented continuation) keeps the list; a task list after a bullet list starts a new one.
          if (next !== undefined && (/^ {2,}\S/.test(next) || (LIST_ITEM.test(next) && listKind(next) === listKind(last ?? "")))) continue;
          break;
        }
        if (LIST_ITEM.test(l) || /^ {2,}\S/.test(l)) out.push(l); else break;
      }
      blocks.push(out.join("\n"));
    } else {
      const out: string[] = [];
      for (; i < lines.length && (lines[i] ?? "").trim() !== "" && (out.length === 0 || !startsBlock(lines[i] ?? "")); i++) out.push(lines[i] ?? "");
      blocks.push(out.join("\n"));
    }
  }
  return blocks.join("\n\n");
}

/** Runs the Markdown fields of a tool input through canon. */
function canonical<T>(input: T): T {
  if (typeof input !== "object" || input === null) return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of ["description_md", "body_md"]) {
    const value = copy[key];
    if (typeof value === "string") copy[key] = canon(value);
  }
  return copy as T;
}

/** Runs one registry tool as the context's actor and returns its data. Markdown fields are put in the editor's form first. */
export async function run<N extends ToolName>(ctx: TesseraContext, name: N, input: ToolInput<N>): Promise<ToolOutput<N>> {
  return (await runToolWithContext(ctx, name, canonical(input))).data;
}

/** A state change scheduled by the core part for a day after its own window; later parts replay it with `drainBurn`. */
export type BurnEntry = { id: string; stateId: string; day: number; pass: 0 | 1 | 2; by: TesseraContext };
const burnQueue: BurnEntry[] = [];
export function resetBurn(): void {
  burnQueue.length = 0;
}
export function queueBurn(entry: BurnEntry): void {
  burnQueue.push(entry);
}

/** Replays the queued state changes of `daysAgo` (start, review, then finish), 11 minutes apart, from the end of that day's story beats. */
export async function drainBurn(clock: DemoClock, daysAgo: number, hour = 17, minute = 40): Promise<number> {
  const due = burnQueue.filter((e) => e.day === daysAgo).sort((a, b) => a.pass - b.pass);
  if (due.length === 0) return 0;
  clock.at(daysAgo, hour, minute);
  for (const entry of due) {
    await run(entry.by, "update_work_item", { work_item_id: entry.id, state_id: entry.stateId });
    clock.step(11);
    burnQueue.splice(burnQueue.indexOf(entry), 1);
  }
  return due.length;
}

export type DemoProjectKey = "MOB" | "PLAT" | "DSN" | "LEG";

/** The projects; LEG is archived at the end of the core part. */
export const DEMO_PROJECTS: Record<DemoProjectKey, { name: string; description: string }> = {
  MOB: { name: "Orbit Mobile", description: "The iOS and Android app travellers use to plan, book and follow their trips." },
  PLAT: { name: "Platform API", description: "Booking, search and payment services behind the apps and the public API." },
  DSN: { name: "Design System", description: "Tokens, components and guidelines shared by every Orbit surface." },
  LEG: { name: "Legacy Booking", description: "The old booking site, retired after the move to the new platform." },
};

/** Anchor items per project, created first and in this order, so their keys are `<project>-<position>`. */
export const DEMO_ANCHORS: Record<Exclude<DemoProjectKey, "LEG">, readonly string[]> = {
  MOB: [
    "Offline mode for saved trips",
    "Push notification preferences screen",
    "Crash on Android 15 when rotating the map",
    "Trip timeline redesign",
    "Sign in with passkeys",
    "Reduce cold start time below 1.5 s",
    "Share a trip as a read-only link",
    "Accessibility audit of the booking flow",
  ],
  PLAT: [
    "Rate limiting for the public API",
    "Move search to the new index",
    "Webhooks for booking status changes",
    "Idempotency keys for payment endpoints",
    "Nightly export job times out",
    "API reference generated from the schema",
    "Deprecate the v1 itinerary endpoints",
    "Trace IDs in every log line",
  ],
  DSN: [
    "Colour tokens for dark mode",
    "Date range picker component",
    "Button focus ring fails contrast",
    "Icon set v3",
    "Motion guidelines",
    "Form field error states",
    "Sync the design library with the code tokens",
    "Typography scale for small screens",
  ],
};

/** `MOB-3` for the third MOB anchor. */
export function anchorKey(project: Exclude<DemoProjectKey, "LEG">, position: number): string {
  return `${project}-${position}`;
}

/**
 * The showcase demo seed (`npm run db:demo`): a travel-planning company ("Orbit") with three active
 * projects and one archived one, filled through the tool registry by the user, the assistant and four
 * agents. The parts run in story order on one clock that only moves forward: core (21 to 13 days ago),
 * pages (12 to 8), workspace (8 to 6) and collab (6 to now), so the last two days carry the most agent
 * activity and Home and the Inbox are full.
 */
import type { DbHandles } from "@/lib/tessera/db/client";
import { seedCollab } from "./collab";
import { seedCore } from "./core";
import { seedPages } from "./pages";
import { createDemoClock, demoActors, DEMO_START_DAYS_AGO } from "./shared";
import { seedWorkspace } from "./workspace";

export type ShowcaseResult = { created: boolean; counts: Record<string, Record<string, number>> };

/** True when a project with identifier MOB exists (archived or not), the marker of an earlier showcase run. */
function showcaseExists(handles: DbHandles): boolean {
  return handles.sqlite.prepare("SELECT 1 FROM project WHERE identifier = 'MOB' LIMIT 1").get() !== undefined;
}

/**
 * Puts "Since you were last here" about 40 hours back, so Home lists the agent activity of the last two days.
 * A database that already had a Home visit keeps a cursor from before the story; this moves it forward (never back).
 */
function moveHomeCursor(handles: DbHandles, base: Date): void {
  const cutoff = new Date(base.getTime() - 40 * 3_600_000).toISOString();
  const row = handles.sqlite.prepare("SELECT seq, created_at FROM activity WHERE created_at <= ? ORDER BY seq DESC LIMIT 1").get(cutoff) as { seq: number; created_at: string } | undefined;
  if (!row) return;
  handles.sqlite.prepare("UPDATE workspace_settings SET last_seen_seq = ?, last_seen_at = ? WHERE last_seen_seq IS NULL OR last_seen_seq < ?").run(row.seq, row.created_at, row.seq);
}

/**
 * Seeds the showcase. Idempotent: when MOB exists nothing is written. `options.now` fixes the real "now"
 * the story ends at (default: the current time).
 */
export async function seedShowcase(handles: DbHandles, options: { now?: Date } = {}): Promise<ShowcaseResult> {
  if (showcaseExists(handles)) return { created: false, counts: {} };
  const clock = createDemoClock(options.now ?? new Date());
  const actors = demoActors(handles, clock);
  const counts: ShowcaseResult["counts"] = {};

  clock.at(DEMO_START_DAYS_AGO, 9);
  counts.core = await seedCore(actors, clock);
  clock.at(12, 9);
  counts.pages = await seedPages(actors, clock);
  clock.at(8, 9);
  counts.workspace = await seedWorkspace(actors, clock);
  clock.at(6, 9);
  counts.collab = await seedCollab(actors, clock);
  moveHomeCursor(handles, clock.base);
  return { created: true, counts };
}

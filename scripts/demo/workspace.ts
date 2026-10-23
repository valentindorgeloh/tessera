/**
 * Showcase demo, workspace part (clock window 8 to 6 days ago): the workspace
 * name and Home layout, stickies, quick links, favourites in folders, workspace
 * drafts and the PLAT automations. Everything runs as the user through the tool
 * registry. Cycles, modules, views and wiki pages are looked up by what they are
 * (the current cycle, the first module, ...), never by id, and skipped when the
 * earlier parts did not create them.
 */
import { anchorKey, drainBurn, run, type DemoActors, type DemoClock, type DemoProjectKey } from "./shared";
import type { TesseraContext } from "@/lib/tessera/core/context";

type ActiveKey = Exclude<DemoProjectKey, "LEG">;
type Counts = Record<string, number>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD, `days` from the real today (the project date fields use local calendar days). */
function isoDay(base: Date, days: number): string {
  const date = new Date(base.getTime() + days * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type ProjectRef = { id: string; identifier: string };

async function findProjects(ctx: TesseraContext): Promise<Record<ActiveKey, ProjectRef>> {
  const list = await run(ctx, "list_projects", {});
  const byIdentifier = new Map(list.items.map((project) => [project.identifier, project]));
  const pick = (key: ActiveKey): ProjectRef => {
    const project = byIdentifier.get(key);
    if (!project) throw new Error(`demo workspace part: project ${key} is missing; run the core part first`);
    return { id: project.id, identifier: project.identifier };
  };
  return { MOB: pick("MOB"), PLAT: pick("PLAT"), DSN: pick("DSN") };
}

export async function seedWorkspace(actors: DemoActors, clock: DemoClock): Promise<Record<string, number>> {
  const user = actors.user;
  const counts: Counts = {
    settings: 0,
    stickies: 0,
    sticky_edits: 0,
    quick_links: 0,
    favorite_folders: 0,
    favorites: 0,
    drafts: 0,
    automations: 0,
  };
  const projects = await findProjects(user);
  const mob = projects.MOB;
  const plat = projects.PLAT;
  const dsn = projects.DSN;
  const workKey = (project: ActiveKey, position: number) => anchorKey(project, position);
  /** The weekday name of the day `daysAgo` days before the story ends (negative: after it), so headings match the calendar of the run. */
  const weekday = (daysAgo: number) => new Date(clock.base.getTime() - daysAgo * DAY_MS).toLocaleDateString("en-GB", { weekday: "long" });

  // ---------------------------------------------------------------------------
  // Workspace settings: the name and the Home layout.
  // ---------------------------------------------------------------------------
  clock.at(8, 14, 10);
  await run(user, "update_workspace_settings", {
    name: "Orbit",
    week_start: 1,
    auto_backup: true,
    ai: { digest_enabled: true },
    home_widgets: [
      { widget: "since_last_visit", enabled: true },
      { widget: "your_work", enabled: true },
      { widget: "quick_links", enabled: true },
      { widget: "stickies", enabled: true },
      { widget: "recents", enabled: true },
    ],
  });
  counts.settings += 1;

  // ---------------------------------------------------------------------------
  // Stickies. New notes go first, so the last one created sits at the top-left.
  // ---------------------------------------------------------------------------
  clock.at(8, 14, 40);
  await run(user, "create_sticky", {
    name: "Contacts for launch week",
    color: "teal",
    description_md: [
      "Who to ask, and where (no numbers here, the team directory has them):",
      "",
      "- **Store review contact:** the mobile team lead. They own the review notes and the demo account.",
      "- **Payments on-call:** the PLAT rota in the shared calendar. Page through the on-call tool, never by DM.",
      "- **Design questions:** the #design-system channel; the design system owner answers within the hour on weekdays.",
      "- **Legal sign-off for the privacy text:** the legal contact, who needs two working days.",
    ].join("\n"),
  });
  clock.step(23);
  const checklist = await run(user, "create_sticky", {
    name: "Before every release",
    color: "green",
    description_md: [
      "- [x] Changelog drafted and linked in the release page",
      "- [x] Crash-free sessions above 99.5% on the last build",
      "- [ ] Smoke test on one iOS and one Android device",
      "- [ ] Release notes translated (de, fr, es)",
      "- [ ] Feature flags for unfinished work are off",
      "- [ ] Tell support what changes before it goes live",
    ].join("\n"),
  });
  clock.step(31);
  await run(user, "create_sticky", {
    name: "Reminder: passkey review",
    color: "orange",
    description_md: [
      `${weekday(-2)} at 14:00, walk through the passkey flow with security before [${workKey("MOB", 5)}](work:${workKey("MOB", 5)}) moves to review.`,
      "",
      "Bring:",
      "",
      "1. The fallback path when a device has no biometrics",
      "2. What happens to existing password users after the first passkey sign-in",
      "3. The recovery story if the phone is lost",
    ].join("\n"),
  });
  clock.step(42);
  await run(user, "create_sticky", {
    name: "Parking lot",
    color: "purple",
    description_md: [
      "Ideas that came up but are not planned yet. Do not lose them:",
      "",
      "- Price drop alerts for saved flights",
      "- Packing list suggestions based on the forecast",
      "- Split costs between travellers on a shared trip",
      "- Boarding pass on the lock screen",
    ].join("\n"),
  });
  clock.step(58);
  const standup = await run(user, "create_sticky", {
    name: "Stand-up notes",
    color: "yellow",
    description_md: [
      `## ${weekday(8)}`,
      "",
      `- Offline mode: sync conflicts are the open question, see [${workKey("MOB", 1)}](work:${workKey("MOB", 1)})`,
      `- Search index move is on track, cut-over rehearsal in two days ([${workKey("PLAT", 2)}](work:${workKey("PLAT", 2)}))`,
      "- Design tokens: dark mode contrast pass still needs a second pair of eyes",
      "",
      "**Blocked:** nothing right now.",
    ].join("\n"),
  });
  clock.step(19);
  await run(user, "create_sticky", {
    name: "Numbers to remember",
    color: "pink",
    description_md: [
      "Where we stand against the targets:",
      "",
      "| What | Target | Now |",
      "| --- | --- | --- |",
      "| Cold start (p90, mid-range Android) | 2.5 s | 2.2 s |",
      "| Search p95 latency | 120 ms | 210 ms |",
      "| Crash-free sessions | 99.5% | 99.4% |",
      "| Weekly active planners | 12,000 | 10,400 |",
    ].join("\n"),
  });
  counts.stickies += 6;
  await drainBurn(clock, 8, 18, 0);

  clock.at(8, 19, 10);
  await run(user, "create_draft", {
    name: "Group trips: who pays for what",
    description_md: [
      "Travellers keep asking how to split costs on a shared trip.",
      "",
      "Open questions:",
      "",
      "- Is this a booking feature or just a note on the trip?",
      "- Do we need currencies, or only the trip currency?",
      "- Who can edit an amount once it is shared?",
    ].join("\n"),
    priority: "low",
    assignee_ids: [],
  });
  counts.drafts += 1;

  // Later the same day: tick the checklist, extend the stand-up notes.
  clock.at(7, 9, 5);
  await run(user, "update_sticky", {
    sticky_id: checklist.id,
    description_md: [
      "- [x] Changelog drafted and linked in the release page",
      "- [x] Crash-free sessions above 99.5% on the last build",
      "- [x] Smoke test on one iOS and one Android device",
      "- [ ] Release notes translated (de, fr, es)",
      "- [ ] Feature flags for unfinished work are off",
      "- [ ] Tell support what changes before it goes live",
    ].join("\n"),
  });
  clock.step(26);
  await run(user, "update_sticky", {
    sticky_id: standup.id,
    description_md: [
      `## ${weekday(7)}`,
      "",
      `- Offline mode: agreed to keep the server copy as the winner for edits older than 24 hours ([${workKey("MOB", 1)}](work:${workKey("MOB", 1)}))`,
      `- Rate limiting: start with 60 requests per minute for free keys and 600 for partners, review after a week ([${workKey("PLAT", 1)}](work:${workKey("PLAT", 1)}))`,
      "- Dark mode tokens ready for review",
      "",
      `## ${weekday(8)}`,
      "",
      `- Offline mode: sync conflicts are the open question, see [${workKey("MOB", 1)}](work:${workKey("MOB", 1)})`,
      `- Search index move is on track, cut-over rehearsal in two days ([${workKey("PLAT", 2)}](work:${workKey("PLAT", 2)}))`,
      "",
      "**Blocked:** nothing right now.",
    ].join("\n"),
  });
  counts.sticky_edits += 2;

  // ---------------------------------------------------------------------------
  // Quick links (Home). An app path and web addresses.
  // ---------------------------------------------------------------------------
  clock.at(7, 10, 20);
  const links: { title: string; url: string }[] = [
    { title: "Status page", url: "https://status.orbit.example" },
    { title: "Design files", url: "https://design.orbit.example/files/orbit-mobile" },
    { title: "Analytics dashboard", url: "https://analytics.orbit.example/dashboards/weekly-planners" },
    { title: "Mobile cycles", url: "/projects/MOB/cycles" },
    { title: "Store review queue", url: "https://stores.orbit.example/review" },
    { title: "Platform API board", url: "/projects/PLAT/work-items?layout=board" },
  ];
  for (const link of links) {
    await run(user, "add_quick_link", link);
    clock.step(4);
    counts.quick_links += 1;
  }

  // ---------------------------------------------------------------------------
  // Favourites in two folders. Entities are looked up by what they are.
  // ---------------------------------------------------------------------------
  clock.at(7, 11, 15);
  const [planning, reference] = [
    await run(user, "create_favorite_folder", { name: "Current work" }),
    await run(user, "create_favorite_folder", { name: "Reference" }),
  ];
  counts.favorite_folders += 2;
  clock.step(5);

  const favourite = async (entity_type: "project" | "cycle" | "module" | "view" | "page", entity_id: string, folder_id: string | null) => {
    await run(user, "add_favorite", { entity_type, entity_id, folder_id });
    counts.favorites += 1;
    clock.step(3);
  };

  // The three projects sit at the top level; the folders hold the work and the reference pages.
  await favourite("project", mob.id, null);
  await favourite("project", plat.id, null);
  await favourite("project", dsn.id, null);

  const mobCycles = await run(user, "list_cycles", { project_id: mob.id });
  const currentCycle = mobCycles.items.find((cycle) => cycle.status === "current") ?? mobCycles.items.find((cycle) => cycle.status === "upcoming");
  if (currentCycle) await favourite("cycle", currentCycle.id, planning.id);

  const mobModules = await run(user, "list_modules", { project_id: mob.id });
  const mobModule = mobModules.items[0];
  if (mobModule) await favourite("module", mobModule.id, planning.id);

  const platViews = await run(user, "list_views", { project_id: plat.id });
  const mobViews = await run(user, "list_views", { project_id: mob.id });
  const view = mobViews.items[0] ?? platViews.items[0];
  if (view) await favourite("view", view.id, planning.id);

  const wiki = await run(user, "list_pages", { project_id: null });
  const wikiPage = wiki.find((page) => page.name === "Orbit handbook");
  if (wikiPage) await favourite("page", wikiPage.id, reference.id);

  const designPages = await run(user, "list_pages", { project_id: dsn.id });
  const designPage = designPages.find((page) => page.name === "Dark mode token map");
  if (designPage) await favourite("page", designPage.id, reference.id);

  // ---------------------------------------------------------------------------
  // Drafts: half-written work items, one per evening or morning so their "edited" times differ.
  // ---------------------------------------------------------------------------
  const mobLabels = await run(user, "list_labels", { project_id: mob.id });
  const pickLabels = (names: string[], fallback: number): string[] => {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    const matched = mobLabels.items.filter((label) => wanted.has(label.name.toLowerCase())).map((label) => label.id);
    return matched.length > 0 ? matched : mobLabels.items.slice(0, fallback).map((label) => label.id);
  };

  clock.at(7, 14, 20);
  await run(user, "create_draft", {
    project_id: mob.id,
    name: "Price drop alerts for saved flights",
    description_md: [
      "Notify a traveller when a saved flight gets cheaper.",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] A price check runs at most every 6 hours per saved flight",
      "- [ ] A push notification is sent only when the drop is at least 5% or 15 EUR",
      "- [ ] No more than one alert per flight per day",
      "- [ ] The alert opens the flight with the old and the new price",
      "",
      "Depends on the notification preferences screen.",
    ].join("\n"),
    priority: "medium",
    label_ids: pickLabels(["Feature", "Enhancement", "Improvement"], 2),
    cycle_id: null,
    assignee_ids: [],
    start_date: isoDay(clock.base, 5),
    target_date: isoDay(clock.base, 19),
  });
  counts.drafts += 1;

  // ---------------------------------------------------------------------------
  // Project automations on MOB and PLAT: auto-archive closed items after 1 month,
  // auto-close inactive items after 3 months into the Cancelled state.
  // ---------------------------------------------------------------------------
  clock.at(7, 16, 40);
  for (const project of [plat, mob]) {
    const states = await run(user, "list_states", { project_id: project.id });
    const cancelled = states.items.find((state) => state.state_group === "cancelled");
    await run(user, "update_project", { project_id: project.id, archive_in_months: 1, close_in_months: 3, close_state_id: cancelled?.id ?? null });
    counts.automations += 1;
    clock.step(14);
  }
  await drainBurn(clock, 7);

  clock.at(6, 7, 50);
  await run(user, "create_draft", {
    project_id: plat.id,
    name: "Look into the p99 spike on search at 08:00 UTC",
    description_md: "Dashboard shows p99 above 2 s for ten minutes every morning. Check whether it lines up with the cache warm-up.",
    priority: "high",
  });
  counts.drafts += 1;
  clock.step(32);

  await run(user, "create_draft", {
    project_id: dsn.id,
    name: "Document the elevation scale",
    priority: "none",
  });
  counts.drafts += 1;

  return counts;
}

/**
 * Showcase demo, collaboration part (clock window 6 to 0 days ago): agents move items, comment and triage, the user
 * answers and decides intake, the assistant applies a few changes. Every write goes through the tool registry, so
 * activity, notifications and search rows are real. Runs after core and pages; anchors are looked up by key.
 */
import type { TesseraContext } from "@/lib/tessera/core/context";
import type { NotificationView } from "@/lib/tessera/notifications";
import type { Reaction } from "@/lib/tessera/reactions";
import { addDays } from "@/lib/tessera/core/time";
import { bug, md, mobReports } from "./collab-text";
import { drainBurn, run, type DemoActors, type DemoClock } from "./shared";

type Ctx = TesseraContext;
type Pri = "urgent" | "high" | "medium" | "low" | "none";
type Rel = "blocked_by" | "blocking" | "relates_to" | "duplicate" | "start_before" | "finish_before" | "implemented_by";
const HOUR = 3_600_000;

export async function seedCollab(actors: DemoActors, clock: DemoClock): Promise<Record<string, number>> {
  const { user, assistant } = actors;
  const { release, triage, coder, docs } = actors.agents;
  const n: Record<string, number> = {};
  const bump = (k: string) => void (n[k] = (n[k] ?? 0) + 1);
  const T = (d: number, h: number, m = 0) => clock.at(d, h, m);
  const S = (m = 18) => clock.step(m);
  /** Moves the clock to `h` hours before the real now (days 0 and 1 are relative so a morning run still orders events). */
  const ago = (h: number) => {
    const t = new Date(clock.base.getTime() - h * HOUR);
    clock.at(t.toDateString() === clock.base.toDateString() ? 0 : 1, t.getHours(), t.getMinutes());
  };
  // A mention is `[Name](actor:<id>)`: the editor rewrites a link text that starts with "@" (see the demo notes).
  const who = (c: Ctx) => `[${c.actor.name}](actor:${c.actor.id})`;
  const get = (key: string) => run(user, "get_work_item_by_key", { key });

  // --- lookups that create what is missing (core may have made them already) ---
  const stateMap = new Map<string, Map<string, string>>();
  const stateId = async (pid: string, name: string): Promise<string> => {
    let m = stateMap.get(pid);
    if (!m) {
      m = new Map((await run(user, "list_states", { project_id: pid })).items.map((s) => [s.name.toLowerCase(), s.id] as const));
      stateMap.set(pid, m);
    }
    let id = m.get(name.toLowerCase());
    if (!id) {
      id = (await run(user, "create_state", { project_id: pid, name, state_group: "started", color: "purple", description: "Waiting for a reviewer." })).id;
      m.set(name.toLowerCase(), id);
    }
    return id;
  };
  const labelMap = new Map<string, Map<string, string>>();
  const labelId = async (pid: string, name: string): Promise<string> => {
    let m = labelMap.get(pid);
    if (!m) {
      m = new Map((await run(user, "list_labels", { project_id: pid })).items.map((l) => [l.name.toLowerCase(), l.id] as const));
      labelMap.set(pid, m);
    }
    let id = m.get(name.toLowerCase());
    if (!id) {
      const colors = { bug: "red", mobile: "blue", backend: "green", frontend: "cyan", accessibility: "purple", docs: "teal", performance: "orange", design: "pink" } as const;
      id = (await run(user, "create_label", { project_id: pid, name, color: colors[name.toLowerCase() as keyof typeof colors] ?? "gray" })).id;
      m.set(name.toLowerCase(), id);
    }
    return id;
  };

  // --- one write per helper, all through the registry ---
  /** State, priority, additive labels and additive assignees in one go; unchanged values write nothing. */
  async function act(c: Ctx, key: string, o: { state?: string; priority?: Pri; labels?: string[]; assign?: Ctx[]; start?: number }) {
    const it = await get(key);
    const patch: { state_id?: string; priority?: Pri; start_date?: string } = {};
    if (o.start !== undefined) patch.start_date = addDays(user.today(), o.start);
    if (o.state) {
      const id = await stateId(it.project_id, o.state);
      if (id !== it.state_id) { patch.state_id = id; bump("state_changes"); }
    }
    if (o.priority && o.priority !== it.priority) { patch.priority = o.priority; bump("priority_changes"); }
    if (Object.keys(patch).length) await run(c, "update_work_item", { work_item_id: it.id, ...patch });
    if (o.labels) {
      const next = new Set(it.label_ids);
      for (const name of o.labels) next.add(await labelId(it.project_id, name));
      if (next.size !== it.label_ids.length) { await run(c, "set_labels", { work_item_id: it.id, label_ids: [...next] }); bump("label_changes"); }
    }
    if (o.assign) {
      const next = new Set([...it.assignee_ids, ...o.assign.map((a) => a.actor.id)]);
      if (next.size !== it.assignee_ids.length) { await run(c, "set_assignees", { work_item_id: it.id, actor_ids: [...next] }); bump("assignments"); }
    }
  }
  const threads = new Map<string, { id: string; v: number }>();
  /** A comment; `tag` remembers it for replies, edits and reactions, `to` is the tag of the root it answers. */
  async function say(c: Ctx, key: string, body: string, o: { tag?: string; to?: string } = {}) {
    const row = await run(c, "create_comment", { work_item_id: (await get(key)).id, body_md: body, parent_comment_id: o.to ? threads.get(o.to)?.id : undefined });
    bump("comments");
    if (o.to) bump("replies");
    // create_comment may also return a { deleted: true } ref (decision 149); the demo sends no client_ref, so it always gets a comment.
    if (o.tag && "body_version" in row) threads.set(o.tag, { id: row.id, v: row.body_version });
  }
  async function edit(c: Ctx, tag: string, body: string) {
    const t = threads.get(tag);
    if (!t) throw new Error(`unknown comment ${tag}`);
    const row = await run(c, "update_comment", { comment_id: t.id, body_md: body, expected_body_version: t.v });
    threads.set(tag, { id: t.id, v: row.body_version });
    bump("edits");
  }
  async function reactItem(c: Ctx, key: string, reaction: Reaction) {
    await run(c, "add_reaction", { target: "work_item", target_id: (await get(key)).id, reaction });
    bump("reactions");
  }
  async function reactNote(c: Ctx, tag: string, reaction: Reaction) {
    await run(c, "add_reaction", { target: "comment", target_id: threads.get(tag)?.id ?? "", reaction });
    bump("reactions");
  }
  async function link(c: Ctx, key: string, title: string, url: string) {
    await run(c, "add_link", { work_item_id: (await get(key)).id, title, url });
    bump("links");
  }
  async function rel(c: Ctx, a: string, type: Rel, b: string) {
    await run(c, "add_relation", { work_item_id: (await get(a)).id, related_work_item_id: (await get(b)).id, relation_type: type });
    bump("relations");
  }
  async function follow(c: Ctx, key: string) {
    await run(c, "subscribe_work_item", { work_item_id: (await get(key)).id });
    bump("subscriptions");
  }
  /** Rewrites a description (a ticked box, an added section) as `c`; the item's updated time moves with it. */
  async function redescribe(c: Ctx, key: string, change: (md: string) => string) {
    const it = await get(key);
    await run(c, "update_work_item_description", { work_item_id: it.id, description_md: change(it.description_md), expected_description_version: it.description_version });
    bump("description_edits");
  }
  async function create(c: Ctx, project: string, name: string, description_md: string, o: { priority?: Pri; labels?: string[]; parent?: string; assign?: Ctx[]; state?: string } = {}) {
    const pid = (await get(`${project}-1`)).project_id;
    const item = await run(c, "create_work_item", {
      project_id: pid,
      name,
      description_md,
      priority: o.priority,
      parent_id: o.parent ? (await get(o.parent)).id : undefined,
      label_ids: await Promise.all((o.labels ?? []).map((l) => labelId(pid, l))),
      assignee_ids: (o.assign ?? []).map((a) => a.actor.id),
      state_id: o.state ? await stateId(pid, o.state) : undefined,
    });
    bump("items_created");
    return item;
  }
  const inbox = async () => (await run(user, "list_notifications", {})).items;
  const markRead = async (rows: NotificationView[]) => {
    if (rows.length === 0) return;
    await run(user, "mark_notifications_read", { ids: rows.map((r) => r.uid) });
    n.notifications_read = (n.notifications_read ?? 0) + rows.length;
  };
  // =============== Setup (day 6): states, subscriptions, project switches, page links ===============
  T(6, 8, 50);
  const pid = { MOB: (await get("MOB-1")).project_id, PLAT: (await get("PLAT-1")).project_id, DSN: (await get("DSN-1")).project_id };
  const mobId = pid.MOB;
  const platId = pid.PLAT;
  const pageIds = new Map<string, string>();
  for (const id of Object.values(pid)) for (const p of await run(user, "list_pages", { project_id: id })) pageIds.set(p.name, p.id);
  const pg = (name: string) => (pageIds.has(name) ? `[${name}](page:${pageIds.get(name)})` : name);
  const intakeBefore = new Map<string, boolean>();
  for (const id of Object.values(pid)) {
    await stateId(id, "In Review");
    intakeBefore.set(id, (await run(user, "get_project", { project_id: id })).agent_intake_required);
    await run(user, "update_project_features", { project_id: id, intake_enabled: true, agent_intake_required: false });
  }
  for (const [project, count] of [["MOB", 8], ["PLAT", 8], ["DSN", 8]] as const) {
    for (let i = 1; i <= count; i++) { await follow(user, `${project}-${i}`); S(1); }
  }
  for (const [c, key] of [[release, "MOB-2"], [release, "MOB-3"], [docs, "PLAT-1"], [docs, "PLAT-3"], [coder, "DSN-3"], [triage, "PLAT-5"]] as const) { await follow(c, key); S(1); }

  // =============== Day 6: triage sweep, the Android 15 crash, review notes on rate limiting ===============
  T(6, 9, 30);
  await act(triage, "PLAT-5", { priority: "urgent", labels: ["Performance"] });
  S(17);
  await act(triage, "DSN-8", { priority: "high", labels: ["Accessibility"] });
  S(17);
  await act(triage, "MOB-5", { priority: "high", assign: [user] });
  T(6, 10, 50);
  await act(user, "MOB-3", { assign: [coder] });
  await act(user, "PLAT-6", { assign: [docs] });
  T(6, 11, 30);
  await say(coder, "MOB-3", md`
    Reproduced on a third phone as well (Android 15, build 4.12.1). Rotating within about 300 ms of a tile load kills the process.
    **Root cause:** the render thread outlives the surface when the activity is recreated. Android 15 throws on the stale access; Android 14 silently ignored it.
    ´´´kotlin
    override fun surfaceDestroyed(holder: SurfaceHolder) {
        renderThread.requestStop()
        renderThread.join(500)   // must finish before the surface is released
        tileFetcher.cancelAll()
    }
    ´´´
    - [x] Reproduce on a device farm
    - [ ] Stop the render thread in ´surfaceDestroyed´
    - [ ] Regression test that rotates 20 times during load

    ${who(user)}, the Saved places map uses the same view, so both screens get the fix. The crash group has 338 events now (312 when this was filed).`, { tag: "mob3" });
  S(4);
  await link(coder, "MOB-3", "Crash group 4821 (Android 15)", "https://crashes.orbit.example/groups/4821");
  T(6, 13, 30);
  await say(coder, "PLAT-1", md`
    Review notes on the limiter. Load test on staging, 200 keys, 5,000 requests per second for 10 minutes:

    | Metric | Result | Target |
    | --- | --- | --- |
    | p99 overhead | 2.1 ms | under 3 ms |
    | Requests wrongly limited | 0 | 0 |
    | Cache outage (fail open) | alert after 8 s | under 15 s |

    The design is in ${pg("Rate limiting design")}. Still open: the dashboard of throttled requests per key.`, { tag: "plat1" });
  await link(coder, "PLAT-1", "Rate limit tiers", "https://docs.orbit.example/api/rate-limits");
  T(6, 15, 10);
  await say(user, "MOB-3", "Which app versions are affected? Support needs the list before the weekend.", { to: "mob3" });
  await reactNote(user, "mob3", "👍");
  await reactNote(triage, "mob3", "👀");
  await reactNote(user, "plat1", "🚀");
  T(6, 16, 35);
  await say(coder, "MOB-3", "Every build since the map renderer rewrite in 4.10, so 4.11.2, 4.12.0 and 4.12.1. Only Android 15 is affected, 0.9% of its sessions. I gave support a workaround: rotate the phone after the map has finished loading.", { to: "mob3" });
  S(30);
  await edit(coder, "mob3", md`
    Reproduced on a third phone as well (Android 15, build 4.12.1). Rotating within about 300 ms of a tile load kills the process.

    **Root cause:** the render thread outlives the surface when the activity is recreated. Android 15 throws on the stale access; Android 14 silently ignored it.

    - [x] Reproduce on a device farm
    - [x] Stop the render thread in ´surfaceDestroyed´
    - [ ] Regression test that rotates 20 times during load

    Affects every build since 4.10, on Android 15 only. The Saved places map shares the view, so both screens get the fix.`);
  await drainBurn(clock, 6);

  // =============== Day 5: API reference, webhook worker, the export job ===============
  T(5, 9, 20);
  await act(docs, "PLAT-6", { state: "In Progress" });
  S(25);
  await say(docs, "PLAT-6", md`
    Starting the generated API reference. Scope for the first cut:

    - [x] Pick the schema source (the OpenAPI file in the platform repo)
    - [ ] Render endpoints grouped by resource, with request and response examples
    - [ ] Publish error codes as a table
    - [ ] Add a "since version" badge to every endpoint
    - [ ] Document rate limits once [PLAT-1](work:PLAT-1) ships
    - [ ] Check links in CI`, { tag: "plat6" });
  S(60);
  await edit(docs, "plat6", md`
    Starting the generated API reference. Scope for the first cut:

    - [x] Pick the schema source (the OpenAPI file in the platform repo)
    - [x] Render endpoints grouped by resource, with request and response examples
    - [ ] Publish error codes as a table
    - [ ] Add a "since version" badge to every endpoint
    - [ ] Document rate limits once [PLAT-1](work:PLAT-1) ships
    - [ ] Check links in CI`);
  T(5, 10, 40);
  const worker = await create(coder, "PLAT", "Webhook delivery worker with retries and signing", md`
      Implements [PLAT-3](work:PLAT-3). Contract: ${pg("Webhook delivery contract")}.

      ## Acceptance criteria
      - Every delivery is signed (HMAC-SHA256 over the body and a timestamp header).
      - Retries at 1 min, 5 min, 30 min, 2 h and 12 h, then the delivery is marked failed.
      - A 429 or 5xx answer retries; a 4xx other than 429 does not.
      - Deliveries for one booking arrive in order.
      - A partner can replay a failed delivery from the dashboard.`, { priority: "medium", labels: ["Webhooks"], parent: "PLAT-3", assign: [user, coder] });
  S(15);
  await rel(coder, "PLAT-3", "implemented_by", worker.key);
  T(5, 13, 0);
  await say(triage, "PLAT-5", md`
    Finance's file was late again on Thursday: the run took 64 minutes and hit the 60 minute limit. The index helped (most nights are down to 44 to 52 minutes) but a partner added 90,000 bookings this month, so we are back near the limit.

    The earlier incident write-up is here: ${pg("Incident review: export timeouts")}.`);
  S(20);
  await act(triage, "PLAT-5", { assign: [coder] });
  S(25);
  const dup = await create(triage, "PLAT", "Nightly export fails after 60 minutes for the largest partner", "The export for the largest partner timed out again on Thursday after 64 minutes. Same symptom as the other timeouts this month.", { priority: "high", labels: ["Bug", "Reliability"] });
  S(10);
  await rel(triage, "PLAT-5", "duplicate", dup.key);
  S(20);
  await act(triage, dup.key, { state: "Cancelled" });
  S(20);
  await say(triage, "PLAT-5", `Closed ${dup.key} as a duplicate of this one, so the discussion stays in a single place.`);
  T(5, 15, 10);
  await say(coder, "PLAT-5", md`
    The remaining cost is memory: each partner file (up to 2.1 GB) is built in a slice before it is written, and garbage collection adds 8 to 10 minutes when two partners run together. Streaming the rows removes both.

    ´´´go
    w := csv.NewWriter(gz) // write straight into the compressed stream
    for rows.Next() {
        if err := rows.Scan(&rec...); err != nil { return err }
        if err := w.Write(rec.Fields()); err != nil { return err }
    }
    ´´´

    Staging with the largest partner: 2.1 GB in 36 minutes, peak memory 180 MB (was 3.4 GB).`, { tag: "export" });
  T(5, 16, 10);
  await say(user, "PLAT-5", "Will the CSV columns change? Finance has a spreadsheet macro that expects the current order.", { to: "export" });
  await reactNote(user, "export", "😕");
  await reactNote(release, "export", "😄");
  T(5, 16, 40);
  await say(coder, "PLAT-5", "No change: same columns, same order, same file name. I added a snapshot test that compares the header row and the first 200 rows with last night's file.", { to: "export" });
  S(30);
  await edit(coder, "export", md`
    The remaining cost is memory: each partner file (up to 2.1 GB) is built in a slice before it is written, and garbage collection adds 8 to 10 minutes when two partners run together. Streaming the rows removes both.

    Staging with the largest partner: 2.1 GB in 36 minutes, peak memory 180 MB (was 3.4 GB). Output is byte-identical to the current file.`);
  await link(user, "PLAT-5", "Failing export runs (last 7 days)", "https://metrics.orbit.example/d/nightly-export");
  await reactItem(user, "PLAT-5", "👎");
  await drainBurn(clock, 5);

  // =============== Day 4: v1 sunset, offline conflicts, a regression ===============
  T(4, 9, 30);
  await say(release, "PLAT-7", md`
    The v1 client inventory is finished: 11 partners still call v1, but three of them make 82% of the calls:

    | Partner | v1 calls / day | Owner |
    | --- | --- | --- |
    | Partner A (flight bundles) | 41,200 | unassigned |
    | Partner B (travel agency) | 28,900 | unassigned |
    | Partner C (corporate tool) | 12,300 | unassigned |

    ${who(user)}, can you take the relationship with these three? The sunset plan needs an owner for each before week 0.`, { tag: "sunset" });
  S(4);
  await link(release, "PLAT-7", "v1 endpoint traffic by customer", "https://metrics.orbit.example/d/v1-traffic");
  await reactNote(user, "sunset", "👍");
  T(4, 10, 50);
  await act(assistant, "PLAT-7", { labels: ["Docs"] });
  S(5);
  await say(assistant, "PLAT-7", "Added the Docs label because the sunset needs a migration guide. A guide item for the three large partners is open as the next step.");
  T(4, 11, 20);
  const guide = await create(docs, "PLAT", "Migration guide for v1 itinerary partners", "Write the request mapping from the v1 itinerary endpoints to v2, with one worked example per endpoint and a table of renamed fields. Review with the three largest partners before it is published.", { priority: "medium", labels: ["Docs", "API"], assign: [user] });
  S(10);
  await rel(docs, guide.key, "relates_to", "PLAT-7");
  T(4, 11, 50);
  await say(coder, "MOB-1", md`
    Status: itinerary, bookings and QR tickets open offline. I am on the edit queue now, with the rules from ${pg("Conflict resolution rules")}.

    ´´´sql
    CREATE TABLE pending_edit (id INTEGER PRIMARY KEY, trip_id TEXT, field TEXT, op TEXT, args TEXT, base_version INTEGER, created_at INTEGER);
    ´´´

    ${who(user)}, one case the spec leaves open: a date edited on a plane (offline) and again on the phone two days later. "Latest edit wins" silently drops the plane edit. Can we keep the losing edit in a conflicts list instead?`, { tag: "offline" });
  T(4, 14, 15);
  await say(user, "MOB-1", "Yes. Keep the losing edit in a conflicts list for 30 days, and show the 'Waiting to sync' badge until the queue is empty.", { tag: "rule", to: "offline" });
  S(40);
  await say(coder, "MOB-1", "Done in the design: conflicts list per trip, 30 day retention, badge on the trip header and on each edited row. I will update the offline sync page too.", { to: "offline" });
  S(10);
  await create(coder, "MOB", "Conflicts list for losing offline edits", "Keep the edit that lost a conflict for 30 days, shown per trip with a Restore button. The trip header and each edited row show the 'Waiting to sync' badge until the queue is empty.\n\n- [ ] Store the losing edit with its device and time\n- [ ] List per trip, newest first\n- [ ] Delete entries after 30 days", { priority: "medium", labels: ["Feature", "Android"], parent: "MOB-1", assign: [user, coder] });
  await reactNote(user, "offline", "❤️");
  await reactItem(user, "MOB-1", "👀");
  await edit(user, "rule", "Yes. Keep the losing edit in a conflicts list for 30 days, and show the 'Waiting to sync' badge until the queue is empty. Notes still merge as the spec says.");
  T(4, 15, 30);
  const regression = await create(triage, "MOB", "Cold start is back at 1.7 s on the 4.13 beta", "p50 cold start on a mid-range Android phone is 1.7 s on the 4.13 beta (build 8812), up from 1.3 s on 4.12. The new onboarding assets landed in that build.\n\nBudget details: " + pg("Cold start budget") + ".", { priority: "high", labels: ["Performance", "Android"], assign: [coder] });
  const currentSprint = (await run(user, "list_cycles", { project_id: mobId })).items.find((c) => c.status === "current");
  if (currentSprint) await run(triage, "add_work_items_to_cycle", { cycle_id: currentSprint.id, work_item_ids: [regression.id] });
  S(5);
  await rel(triage, regression.key, "relates_to", "MOB-6");
  S(5);
  await say(triage, "MOB-6", `Not reopening this item: 4.12 met the target. The regression in the 4.13 beta is tracked in [${regression.key}](work:${regression.key}).`);
  T(4, 16, 40);
  await link(coder, "MOB-1", "Offline sync design notes", "https://wiki.orbit.example/mobile/offline-sync");
  await rel(user, "MOB-4", "blocked_by", "DSN-1");
  T(4, 17, 10);
  await act(coder, "PLAT-5", { state: "In Review" });
  S(5);
  await say(coder, "PLAT-5", "The streaming export is merged and deployed with platform 2026.10.2. It runs for the first time tonight. I keep this item in review until three nights have passed.");
  await drainBurn(clock, 4, 18, 0);

  // =============== Day 3: reviews, search migration, design tokens ===============
  T(3, 8, 30);
  await act(assistant, "MOB-7", { priority: "medium" });
  T(3, 9, 30);
  await say(coder, "MOB-2", md`
    Pull request is up: [Notification preferences screen](https://code.orbit.example/orbit-mobile/pulls/1475). Status against the criteria:

    - [x] Four categories with toggles and quiet hours (22:00 to 07:00 by default)
    - [x] A category that is off sends no push but stays in the in-app list
    - [ ] Sync across devices within 5 s (waiting for the endpoint in [PLAT-3](work:PLAT-3))
    - [ ] Screen reader announcements checked on both platforms`);
  T(3, 10, 40);
  await say(coder, "PLAT-2", md`
    Search migration, week 2. Dual-write has run for 9 days with no divergence in the nightly diff:

    | Check | Old index | New index |
    | --- | --- | --- |
    | Bookings written (last 9 days) | 1,284,310 | 1,284,310 |
    | p95 query time | 210 ms | 112 ms |
    | Full reindex | 9 h | 4.5 h |

    Next: shadow-read 5% of traffic and compare the top ten results.`);
  T(3, 11, 0);
  await act(coder, "PLAT-3", { state: "In Progress", start: -3 });
  S(25);
  await say(docs, "PLAT-3", md`
    Drafting the webhook guide while the worker is built. Checklist:

    - [x] Event catalogue: ´booking.confirmed´, ´booking.changed´, ´booking.cancelled´, ´booking.ticketed´
    - [ ] Payload example for each event
    - [ ] Signature verification (HMAC-SHA256) with a code sample
    - [ ] Retry schedule and what counts as a failed delivery`);
  S(20);
  await link(docs, "PLAT-3", "Webhook payload examples", "https://docs.orbit.example/api/webhooks");
  T(3, 12, 30);
  await rel(triage, "MOB-8", "relates_to", "DSN-6");
  await rel(triage, "MOB-2", "blocked_by", "PLAT-3");
  T(3, 13, 40);
  await say(coder, "PLAT-4", md`
    Two weeks after release: 1,204 requests were replayed from a stored response and none created a second charge. 31 requests reused a key with a different body and got ´422 idempotency_key_reused´, all from one partner sandbox.

    Rules as shipped: ${pg("Idempotency key rules")}.`, { tag: "idem" });
  await reactNote(release, "idem", "🚀");
  await reactItem(coder, "PLAT-4", "🎉");
  T(3, 14, 30);
  await say(release, "DSN-1", "Heads up: the token freeze for the next app release starts on Thursday. Anything for dark mode that is not merged by then goes into the release after.");
  T(3, 15, 20);
  await rel(coder, "DSN-1", "start_before", "DSN-6");
  S(4);
  await say(coder, "DSN-1", md`
    First dark values, with measured contrast for text pairs (full map: ${pg("Dark mode token map")}):

    | Pair | Light | Dark |
    | --- | --- | --- |
    | ´text-primary´ on ´surface-base´ | 15.8 : 1 | 14.9 : 1 |
    | ´text-muted´ on ´surface-base´ | 6.1 : 1 | 7.6 : 1 |
    | ´text-muted´ on ´surface-raised´ | 5.6 : 1 | 6.2 : 1 |`, { tag: "tokens" });
  S(40);
  await create(coder, "DSN", "Audit other components for the old focus ring colour", "After the focus ring fix, search the component library for hard-coded ring colours (outline, box-shadow, border on :focus-visible). List each hit with its file and replace it with the focus ring token.", { priority: "medium", labels: ["Accessibility", "Component"], assign: [user] });
  T(3, 16, 40);
  await say(user, "DSN-1", "Could the contrast table also list the pairs on surface-raised? Cards are where we saw the worst problems.", { to: "tokens" });
  S(20);
  await say(docs, "DSN-1", "Added to the token map page: surface-raised pairs are now in a second table, all above 4.5 : 1 in both themes.", { to: "tokens" });
  await reactNote(user, "tokens", "🎉");
  // Reading pass A: the oldest notifications are mostly done with.
  T(3, 17, 30);
  const early = (await inbox()).filter((r) => !r.read_at && Date.parse(r.sort_at) < Date.parse(clock.now()) - 2.2 * 24 * HOUR);
  const firstMention = early.find((r) => r.kind === "mentioned");
  await markRead(early.filter((r) => r.uid !== firstMention?.uid));
  await drainBurn(clock, 3, 18, 0);

  // =============== Day 2: review, release, the intake wave starts ===============
  T(2, 8, 45);
  await say(coder, "MOB-2", `${who(user)}, the preferences screen is ready for your review. Screenshots for iOS and Android are on the pull request. Please check the copy on the quiet hours row.`);
  T(2, 9, 20);
  await redescribe(coder, "MOB-1", (text) => text.replace("- [ ] Edits made offline carry a 'Waiting to sync' badge", "- [x] Edits made offline carry a 'Waiting to sync' badge"));
  T(2, 10, 20);
  await run(user, "update_project_features", { project_id: mobId, agent_intake_required: true });
  S(10);

  const reports = mobReports(triage, release);
  const created: Record<number, string> = {};
  /** Files report `i` from its agent at its own time; the project requires agent intake, so it lands in Intake. */
  async function report(i: number) {
    const r = reports[i];
    if (!r) return;
    T(r.at[0], r.at[1], r.at[2]);
    created[i] = (await create(r.by, "MOB", r.name, r.body, { priority: r.priority, labels: r.labels })).id;
    bump("intake_created");
  }
  await report(0);
  await report(1);
  T(2, 11, 45);
  await say(user, "PLAT-4", "What happens when a client retries after 24 hours with the same key? I would rather create a new payment than return an old receipt.", { tag: "ttl", to: "idem" });
  T(2, 12, 20);
  await say(coder, "PLAT-4", "After 24 h the key is gone, so the retry is treated as a new payment. We only replay inside the window. There is a test for the boundary: 23 h 59 min replays, 24 h 01 min creates.", { to: "ttl" });
  T(2, 13, 0);
  await act(assistant, "DSN-5", { priority: "low" });
  await report(2);
  T(2, 14, 0);
  await rel(docs, "PLAT-1", "finish_before", "PLAT-6");
  await report(3);
  T(2, 15, 45);
  await act(release, "PLAT-1", { state: "Done" });
  S(25);
  await say(release, "PLAT-1", md`
    Released with platform 2026.10.3. First 24 hours in production:

    | Plan | Keys | Throttled requests |
    | --- | --- | --- |
    | Free | 212 | 0.9% |
    | Partner | 38 | 0.1% |

    Most throttling came from two partner keys that polled every second. We contacted both.`);
  await reactItem(user, "PLAT-1", "🎉");
  T(2, 16, 40);
  await act(coder, "MOB-3", { state: "In Review" });
  S(15);
  await say(coder, "MOB-3", "The fix is in review: [Fix: stop the render thread before the surface is released](https://code.orbit.example/orbit-mobile/pulls/1482). It includes the 20-rotation regression test. On the internal beta: 338 crashes before, 0 in 36 hours.");

  T(2, 17, 10);
  const todo = await stateId(mobId, "Todo");
  const intakeOf = async (i: number) => (await run(user, "list_intake_items", { project_id: mobId, tab: "open" })).items.find((p) => p.work_item_id === created[i])?.id ?? "";
  await run(user, "accept_intake_item", { intake_item_id: await intakeOf(0), state_id: todo });
  S(22);
  await run(user, "mark_intake_duplicate", { intake_item_id: await intakeOf(1), duplicate_of_id: (await get("MOB-3")).id });
  await drainBurn(clock, 2, 18, 15);

  // =============== Day 1: hotfix shipped, the rest of the intake, decisions ===============
  await report(4);
  T(1, 9, 15);
  await link(assistant, "MOB-4", "Timeline v2 mockups", "https://design.orbit.example/files/trip-timeline-v2");
  await say(assistant, "MOB-4", "Added the v2 mockups link from the design folder and noted that the timeline depends on the dark palette in [DSN-1](work:DSN-1).");
  await rel(assistant, "PLAT-6", "relates_to", "PLAT-3");
  await report(5);
  await report(6);
  T(1, 10, 40);
  await act(release, "MOB-3", { state: "Done" });
  S(18);
  await say(release, "MOB-3", md`
    Shipped in 4.12.2 (staged rollout: 20%, then 100% after 6 hours with no new crash groups).

    **Release notes**
    - Fixed a crash when rotating the map on Android 15.
    - The Saved places map no longer redraws twice on rotation.

    Crash group 4821 is closed.`);
  await reactItem(release, "MOB-3", "🚀");
  await reactItem(user, "MOB-3", "🚀");
  await report(7);
  T(1, 11, 40);
  await say(user, "MOB-3", "Thanks for the quick turnaround. The duplicate report from support is now linked to this item.");
  T(1, 14, 0);
  await run(release, "create_intake_item", { project_id: platId, name: "CSV export drops the last row when a page boundary lands on it", priority: "medium", description_md: bug("The booking CSV export skips one booking whenever the row count is an exact multiple of 1,000.", ["Filter bookings so that exactly 2,000 match", "Export as CSV", "Count the rows"], "2,000 rows plus the header.", "2,000 rows including the header, so the last booking is missing.", "Platform 2026.10.3, web dashboard") });
  bump("intake_created");
  T(1, 15, 30);
  await run(user, "accept_intake_item", { intake_item_id: await intakeOf(2), state_id: todo });
  T(1, 16, 20);
  await run(user, "decline_intake_item", { intake_item_id: await intakeOf(3) });
  T(1, 17, 5);
  const monday = new Date(clock.base.getTime() + 7 * 24 * HOUR);
  monday.setHours(9, 0, 0, 0);
  await run(user, "snooze_intake_item", { intake_item_id: await intakeOf(4), until: monday.toISOString() });
  Object.assign(n, { intake_accepted: 2, intake_declined: 1, intake_snoozed: 1, intake_duplicates: 1 });
  await drainBurn(clock, 1, 17, 50);

  // Reading pass B: everything older than the burst is read except the newest open intake item; two archived, one snoozed.
  ago(7);
  const older = (await inbox()).filter((r) => !r.read_at && !r.archived_at && !r.is_snoozed);
  const open = new Set((await run(user, "list_intake_items", { project_id: mobId, tab: "open" })).items.map((i) => i.work_item_id));
  const keep = new Set([...older.filter((r) => r.kind === "intake_received" && open.has(r.work_item_id ?? "")).slice(-1)].map((r) => r.uid));
  await markRead(older.filter((r) => !keep.has(r.uid)));
  S(5);
  const toArchive = (await inbox()).filter((r) => r.read_at && r.kind === "state_changed" && !r.archived_at).slice(-2);
  if (toArchive.length) {
    await run(user, "archive_notifications", { ids: toArchive.map((r) => r.uid) });
    n.notifications_archived = toArchive.length;
  }
  const toSnooze = (await inbox()).find((r) => r.kind === "updated" && !r.read_at && !r.archived_at);
  if (toSnooze) {
    await run(user, "snooze_notifications", { ids: [toSnooze.uid], until: monday.toISOString() });
    n.notifications_snoozed = 1;
  }

  // =============== The last six hours: a burst from four agents ===============
  ago(5.7);
  await act(coder, "MOB-5", { state: "In Progress" });
  ago(5.2);
  await act(release, "PLAT-5", { state: "Done" });
  S(5);
  await say(release, "PLAT-5", "The streaming export has been live for four nights and finished in 41, 38 and 40 minutes on the last three. Closing this item; the 45 minute alert stays on.");
  ago(4.7);
  await act(triage, "MOB-7", { priority: "high" });
  S(4);
  await act(triage, "MOB-7", { assign: [user] });
  ago(4.2);
  await say(docs, "PLAT-6", `${who(user)}, the first section of the API reference builds from the schema: 38 endpoints, 112 examples and the error table. Could you read the Bookings chapter for tone before I generate the rest?`);
  ago(3.7);
  await act(coder, "DSN-1", { state: "In Review" });
  S(5);
  await say(coder, "DSN-1", "Every semantic token now has a light and a dark value, and all text pairs pass 4.5 : 1. Review: [Dark values for all semantic tokens](https://code.orbit.example/design-system/pulls/611).");
  await link(coder, "DSN-1", "Contrast report", "https://design.orbit.example/reports/dark-mode-contrast");
  ago(3.1);
  await say(release, "DSN-3", "Live in design-system 2.8.0. Every component picks up the new focus ring without changes in the apps.");
  await reactItem(assistant, "DSN-3", "👍");
  ago(2.5);
  await say(coder, "PLAT-4", `${who(user)}, I would like to extend the key lifetime to 72 hours for refunds only: banks can take two days to answer. Payments stay at 24 hours. OK to go ahead?`);
  S(4);
  await redescribe(coder, "PLAT-4", (text) => `${text}\n\n## Proposal (waiting for approval)\nKeep refund keys for 72 hours; payment keys stay at 24 hours. Tracked in the sub-item "Keep refund keys for 72 hours".`);
  ago(1.9);
  await run(triage, "create_intake_item", { project_id: platId, name: "Webhook retries are not sent when the endpoint answers 429", description_md: bug("When a partner endpoint rate-limits us with a 429, the delivery is marked failed and never retried.", ["Point a test webhook at an endpoint that returns 429", "Create a booking", "Check the delivery log"], "Retries at 1 min, 5 min and 30 min.", "One attempt, status ´failed´, no retry scheduled.", "Platform 2026.10.3, sandbox"), priority: "high" });
  bump("intake_created");
  ago(1.4);
  await act(coder, regression.key, { state: "In Progress" });
  S(8);
  await say(coder, regression.key, md`
    ${who(user)}, first measurements after lazy-loading the onboarding assets (p50, mid-range devices):

    | Device | 4.12 | 4.13 beta | With the fix |
    | --- | --- | --- | --- |
    | Mid-range Android (2023) | 1.3 s | 1.7 s | 1.2 s |
    | Low-end Android (2022) | 1.6 s | 2.1 s | 1.5 s |
    | iOS phone (3 years old) | 1.0 s | 1.1 s | 1.0 s |

    The low-end Android phone is right at the 1.5 s limit; the next step is the image decoder.`);
  await link(coder, regression.key, "Cold start dashboard", "https://metrics.orbit.example/d/cold-start");
  ago(0.8);
  await say(release, "MOB-2", "The notification preferences screen is in the 4.13.0 beta (5% of testers). Sync across devices stays off until the preferences endpoint ships with PLAT-3; 38% of the testers turned off tips and offers so far.");
  ago(0.4);
  await say(docs, "PLAT-3", "The webhook guide draft is ready for review: events, payload examples and the signature check are written. The retry section waits for the worker.");

  for (const id of Object.values(pid)) await run(user, "update_project_features", { project_id: id, agent_intake_required: intakeBefore.get(id) ?? false });
  n.user_unread_notifications = (await inbox()).filter((r) => !r.read_at && !r.archived_at && !r.is_snoozed).length;
  return n;
}

/**
 * Demo part 3 of 4: pages (clock window 12 to 8 days ago). A workspace wiki
 * (the "Orbit handbook" with three levels), project pages that link to the
 * anchor work items (the engine records page_embed rows, so those items show
 * "Mentioned in"), several versions per page from different actors, one
 * locked page, private pages, page labels and one outdated page archived with
 * its child. Everything goes through the typed tool registry.
 *
 * Bodies are built from short blocks joined by blank lines (`md`) so this file
 * stays within the file budget.
 */
import type { PaletteColor } from "@/lib/tessera/types";
import { drainBurn, run, type DemoActors, type DemoClock, type DemoProjectKey } from "./shared";

type Who = "user" | "assistant" | "release" | "triage" | "coder" | "docs";
type Spec = {
  key: string;
  name: string;
  who: Who;
  body: string;
  space?: DemoProjectKey;
  parent?: string;
  access?: "public" | "private";
  icon?: string;
  color?: PaletteColor;
  labels?: string[];
};
type Made = { id: string; name: string; version: number; space: DemoProjectKey | null };

const FENCE = "```";
const md = (...blocks: string[]) => blocks.join("\n\n");
const fence = (lang: string, code: string) => `${FENCE}${lang}\n${code}\n${FENCE}`;
/** `[MOB-1](work:MOB-1)`: the editor draws it as a chip and the engine records an embed. */
const w = (key: string) => `[${key}](work:${key})`;

const LABELS: Record<DemoProjectKey, [string, PaletteColor][]> = {
  MOB: [["Design doc", "blue"], ["Release", "orange"]],
  PLAT: [["Design doc", "blue"], ["Incident", "red"]],
  DSN: [["Design doc", "blue"], ["Reference", "teal"]],
  LEG: [],
};

export async function seedPages(actors: DemoActors, clock: DemoClock): Promise<Record<string, number>> {
  const count = { wiki_pages: 0, project_pages: 0, edits: 0, locked: 0, private: 0, archived: 0, labels_created: 0, labelled_pages: 0 };
  const made = new Map<string, Made>();
  const projectIds = new Map<string, string>();
  const labelIds = new Map<string, string>();
  const ctxOf = (who: Who) => (who === "user" ? actors.user : who === "assistant" ? actors.assistant : actors.agents[who]);
  // The label has no "@": the editor rewrites a link text that starts with it (see the demo notes).
  const me = `[You](actor:${actors.user.actor.id})`;
  const eventTime = (offsetDays: number) => new Date(Date.parse(clock.now()) + offsetDays * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  const dayLabel = (offset: number) => new Date(Date.parse(clock.now()) + offset * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  const listed = await run(actors.user, "list_projects", {});
  for (const p of listed.items) projectIds.set(p.identifier, p.id);
  for (const key of ["MOB", "PLAT", "DSN"] as const) {
    const project_id = projectIds.get(key);
    if (!project_id) throw new Error(`demo pages need project ${key}; run the core part first`);
    const existing = (await run(actors.user, "list_labels", { project_id })).items;
    for (const [name, color] of LABELS[key]) {
      const found = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (found) labelIds.set(`${key}:${name}`, found.id);
      else {
        labelIds.set(`${key}:${name}`, (await run(actors.user, "create_label", { project_id, name, color })).id);
        count.labels_created++;
      }
    }
  }

  const L = (key: string) => `[${made.get(key)!.name}](page:${made.get(key)!.id})`;
  const make = async (s: Spec) => {
    const parent = s.parent ? made.get(s.parent) : undefined;
    const space = parent ? parent.space : (s.space ?? null);
    const label_ids = (s.labels ?? []).map((name) => labelIds.get(`${space}:${name}`)!);
    const out = await run(ctxOf(s.who), "create_page", {
      project_id: space ? projectIds.get(space)! : null,
      parent_id: parent?.id ?? null,
      name: s.name,
      description_md: s.body,
      access: s.access ?? "public",
      logo: s.icon ? { icon: s.icon, color: s.color ?? "blue" } : null,
      ...(label_ids.length > 0 ? { label_ids } : {}),
    });
    made.set(s.key, { id: out.id, name: s.name, version: out.description_version, space });
    if (space) count.project_pages++;
    else count.wiki_pages++;
    if (s.access === "private") count.private++;
    if (label_ids.length > 0) count.labelled_pages++;
    clock.step(9);
  };
  const adr3Accepted = () =>
    md("# ADR-003: One token source for web and native", "**Status:** accepted", "## Context", "Colours and spacing are defined twice, in the design library and in code, and they drift (" + w("DSN-7") + ").", "## Decision", "Tokens live in one JSON file in the repository. A build step generates the Swift, Kotlin and CSS outputs. The design library imports the same file. Colour values: " + L("tokens") + ".");
  /** Replaces the body as `who`; always at least 15 minutes after the previous write so versions do not collapse. */
  const edit = async (key: string, who: Who, body: string, minutes = 25) => {
    const m = made.get(key)!;
    clock.step(minutes);
    const out = await run(ctxOf(who), "update_page_body", { page_id: m.id, description_md: body, expected_description_version: m.version });
    m.version = out.description_version;
    count.edits++;
  };
  const pageOp = async (tool: "lock_page" | "archive_page", who: Who, key: string) => {
    clock.step(12);
    await run(ctxOf(who), tool, { page_id: made.get(key)!.id });
  };

  // ---------------------------------------------------------------- day 12: the handbook skeleton
  clock.at(12, 9, 30);
  const handbookV1 = md("# Orbit handbook", "How we build, ship and look after the Orbit travel app. Pick the section that matches your day; every section starts with the one thing to remember.", "- **Engineering**: on-call, reviews, releases\n- **Product vision**: why we build what we build\n- **Design principles**: how it should feel\n- **Decision records**: why things are the way they are");
  await make({ key: "handbook", name: "Orbit handbook", who: "user", icon: "Book", color: "purple", body: handbookV1 });
  await make({ key: "eng", name: "Engineering", parent: "handbook", who: "user", icon: "Gear", color: "gray", body: md("# Engineering", "Three rules sit above everything else:", "1. Production is read-only on Fridays after 15:00 unless it is a fix.\n2. Every change has a reviewer who did not write it.\n3. If something pages you twice, it gets a ticket.") });
  await make({ key: "vision", name: "Product vision", parent: "handbook", who: "user", icon: "Target", color: "pink", body: md("# Product vision", "Orbit turns the messy middle of a trip (tabs, screenshots, group chats) into one plan that still works when the signal does not.", "## What good looks like in 18 months", "- A traveller plans a five-day trip in **under 10 minutes**.\n- Everything on a saved trip opens **with no signal for 72 hours** (see " + w("MOB-1") + ").\n- A group of six can agree on a plan without leaving the app.\n- Support contacts per 1,000 bookings drop below 4 (today: 11).", "## What we will not do", "We do not sell hotel rooms ourselves, we do not build a social feed, and we do not add a feature that only works with a connection.") });
  await make({ key: "design", name: "Design principles", parent: "handbook", who: "user", icon: "Diamond", color: "cyan", body: md("# Design principles", "1. **Calm first.** One primary action per screen; a trip never shouts.\n2. **Honest states.** Offline, syncing and failed look different, and say why.\n3. **Reachable.** Thumb-height targets (44 pt), real contrast, and every flow usable with a screen reader.\n4. **Consistent.** If a token exists, use it. If it does not, ask for one (" + w("DSN-7") + ").") });
  await make({ key: "adrs", name: "Decision records", parent: "handbook", who: "user", icon: "Flag", color: "orange", body: md("# Decision records", "Short notes on decisions that are expensive to reverse. One page each: context, decision, consequences. Status is one of *proposed*, *accepted*, *superseded*.") });
  const reviewList = md("# Code review checklist", "Reviewers, in this order:", "- [ ] The description says what changed and why, with a link to the work item\n- [ ] The change is small enough to read in 20 minutes (otherwise ask for a split)\n- [ ] Tests fail without the change and pass with it\n- [ ] No new network call without a timeout and an offline path\n- [ ] Strings are translatable; no hard-coded dates or currencies\n- [ ] Accessibility: labels, focus order and contrast checked on one real device", "Approve with comments only when none of the comments blocks the release.");
  await make({ key: "review", name: "Code review checklist", parent: "eng", who: "user", icon: "Cube", color: "blue", body: reviewList });
  const releaseV1 = md("# Release process", "The mobile apps ship every second Tuesday. The API ships whenever a change is ready and green.", "## Steps\n1. Freeze `main` on Monday at 12:00 and cut `release/x.y`.\n2. Run the full regression suite. No red tests, no skipped smoke tests.\n3. Upload to the iOS beta channel and the Android internal track.\n4. Dogfood for 24 hours with at least 15 people.\n5. Roll out to 10%, then 50%, then 100% over three days.", "## Commands", fence("bash", "./scripts/cut-release.sh 4.12.0\n./scripts/upload-beta.sh --track internal"));
  await make({ key: "release", name: "Release process", parent: "eng", who: "user", icon: "Rocket", color: "orange", body: releaseV1 });

  clock.at(12, 14, 10);
  const personas = md("# Personas", "| Persona | Trips a year | What they need | Where we fail them today |\n|---|---|---|---|\n| Maya, weekend planner | 4 | One screen with the whole weekend | Tickets live in email |\n| Jonas, group organiser | 3 | Everyone sees and votes on the plan | Sharing is screenshots (" + w("MOB-7") + ") |\n| Priya, business traveller | 18 | Changes in two taps, works in airports | Slow cold start, patchy offline (" + w("MOB-6") + ") |", "We design for Jonas first: if a group can use it, Maya and Priya can.");
  await make({ key: "personas", name: "Personas", parent: "vision", who: "user", icon: "Star", color: "yellow", body: personas });
  await make({ key: "a11y", name: "Accessibility checklist", parent: "design", who: "user", icon: "Flag", color: "green", body: md("# Accessibility checklist", "Run this before a screen leaves design and again before release.", "- [x] Text contrast at least 4.5:1, large text 3:1\n- [x] Touch targets at least 44 x 44 pt\n- [ ] Focus ring visible on every control (open: " + w("DSN-3") + ")\n- [ ] Screen reader reads the booking flow in order (audit: " + w("MOB-8") + ")\n- [ ] Dynamic type up to 200% without clipping\n- [ ] Motion respects reduce-motion", "Failures go on the work item for the screen, labelled **Accessibility**.") });
  const adr1 = md("# ADR-001: Store trips on the device first", "**Status:** accepted", "## Context", "Travellers lose signal in airports, tunnels and abroad. A server-first app shows spinners exactly when the trip matters.", "## Decision", "The device holds the full trip in a local database. The server is the sync partner, not the source for reads. Design: " + w("MOB-1") + ".", "## Consequences", "- Reads are instant and work offline.\n- We must resolve conflicts (rules in the project page).\n- Schema changes need a client migration.");
  await make({ key: "adr1", name: "ADR-001: Store trips on the device first", parent: "adrs", who: "user", body: adr1 });
  await make({ key: "adr3", name: "ADR-003: One token source for web and native", parent: "adrs", who: "user", body: md("# ADR-003: One token source for web and native", "**Status:** proposed", "## Context", "Colours and spacing are defined twice, in the design library and in code, and they drift (" + w("DSN-7") + ").", "## Decision", "Tokens live in one JSON file in the repository. A build step generates the Swift, Kotlin and CSS outputs. The design library imports the same file.", "## Open question", "Who reviews a token change: design, engineering or both?") });
  await edit("handbook", "user", md(handbookV1, "Maintained by the whole team. Fix what is wrong; ask in #handbook if unsure."), 40);

  await drainBurn(clock, 12);

  // ---------------------------------------------------------------- day 11: docs-writer drafts, project pages start
  clock.at(11, 10, 0);
  const glossary = md("# Glossary", "| Term | Meaning |\n|---|---|\n| Trip | A named plan with dates and travellers |\n| Itinerary | The ordered list of segments in a trip |\n| Segment | One flight, stay, ride or activity |\n| Hold | A price kept for 15 minutes while the traveller pays |\n| Booking | A confirmed, paid segment |\n| Voucher | The proof a provider gives us; shown in the app, works offline |\n| Sync token | Opaque marker of what a device has already received |", "Open question for " + me + ": should *Trip* and *Itinerary* stay two words in the interface, or do travellers read them as one thing?");
  await make({ key: "glossary", name: "Glossary", parent: "vision", who: "docs", icon: "Book", color: "green", body: glossary });
  const oncall = md("# On-call guide", "One engineer carries the pager for a week, Monday 10:00 to Monday 10:00. A second engineer is the escalation.", "## What pages you", "| Alert | Threshold | First action |\n|---|---|---|\n| Booking API 5xx | above 2% for 5 min | Check the last deploy; roll back if it is under an hour old |\n| Payment confirm latency | p95 above 1.8 s for 10 min | Check the provider status page, then queue depth |\n| Nightly export | not done by 04:30 | Read " + w("PLAT-5") + " before restarting it |\n| Push delivery | below 92% for 15 min | Pause marketing sends first |", "## First ten minutes", "1. Acknowledge the page within 5 minutes.\n2. Open a thread in #incidents with the alert name and the time.\n3. Decide: fix, roll back or escalate. Write the decision down.", "## Handover", "- [ ] Open incidents listed, each with an owner\n- [ ] Silenced alerts listed with an end time\n- [ ] Anything flaky has a ticket");
  await make({ key: "oncall", name: "On-call guide", parent: "eng", who: "docs", icon: "Lightning", color: "yellow", body: oncall });

  clock.at(11, 13, 30);
  const offline = md("# Offline sync design", "Status: draft for review. Owner: " + me + ". Work item: " + w("MOB-1") + ". Decision: " + L("adr1") + ".", "## Goals", "- Open any saved trip with **no connection for 72 hours**.\n- Open a saved trip in under 400 ms from a cold start.\n- Edits made offline reach the server within 30 s of reconnecting.", "## What is available offline", "| Data | Offline | Notes |\n|---|---|---|\n| Itinerary and vouchers | read and edit | Full copy per saved trip |\n| Maps | read | Tiles for the trip area only, about 40 MB |\n| Search and prices | no | Needs the network |\n| Sharing | no (" + w("MOB-7") + ") | Link is created online |", "## Sync flow", "1. Device sends its **sync token** and the list of local changes.\n2. Server applies them, answers with everything newer than the token.\n3. Device stores the new token only after the answer is written.", "Merge rules are on the child page.");
  await make({ key: "offline", name: "Offline sync design", who: "user", space: "MOB", icon: "Package", color: "blue", labels: ["Design doc"], body: offline });
  const conflicts = md("# Conflict resolution rules", "Two devices edit the same trip while apart. These rules decide the result, in this order:", "| # | Situation | Result |\n|---|---|---|\n| 1 | Different fields changed | Keep both |\n| 2 | Same field changed on both | Newest edit wins, the other is kept in the trip history |\n| 3 | Segment deleted on one, edited on the other | Deletion wins unless the edit is a booking |\n| 4 | Booked segment edited offline | Never applied; the traveller sees a prompt |", "Reference implementation of rule 2:", fence("ts", "export function mergeField<T>(local: Stamped<T>, remote: Stamped<T>): Stamped<T> {\n  if (local.editedAt === remote.editedAt) return local.deviceId < remote.deviceId ? local : remote;\n  return local.editedAt > remote.editedAt ? local : remote;\n}"));
  await make({ key: "conflicts", name: "Conflict resolution rules", parent: "offline", who: "user", icon: "Diamond", color: "blue", body: conflicts });
  const rate = md("# Rate limiting design", "Work item: " + w("PLAT-1") + ". Status: in review.", "## Why", "One partner's retry loop took search down for 11 minutes. We need a limit that is fair, visible and cheap to check.", "## Tiers", "| Tier | Requests per minute | Burst |\n|---|---|---|\n| Free key | 60 | 120 |\n| Partner | 600 | 1,200 |\n| Internal | unlimited | n/a |", "## Behaviour", "- Token bucket per key, refilled continuously.\n- Every response carries `X-RateLimit-Remaining` and `X-RateLimit-Reset`.\n- Over the limit: `429` with `Retry-After` in seconds.");
  await make({ key: "rate", name: "Rate limiting design", who: "user", space: "PLAT", icon: "Gear", color: "purple", labels: ["Design doc"], body: rate });
  const tokens = md("# Dark mode token map", "How each semantic colour token resolves. Work: " + w("DSN-1") + ". The source of truth will move into one file (" + L("adr3") + ").", "| Token | Light | Dark |\n|---|---|---|\n| `surface/base` | #FFFFFF | #14161B |\n| `surface/raised` | #F5F6F8 | #1D2027 |\n| `text/primary` | #14161B | #F2F3F5 |\n| `text/muted` | #5B6270 | #A3A9B6 |\n| `accent/default` | #3B5BDB | #7C93F0 |", "Rule: never use a raw hex in a component. Use the token, even when the value looks identical."); // hex-ok: demo page content
  await make({ key: "tokens", name: "Dark mode token map", who: "user", space: "DSN", icon: "Diamond", color: "cyan", labels: ["Design doc"], body: tokens });
  await edit("handbook", "user", md(handbookV1, "## Sections", "- " + L("eng") + " (" + L("oncall") + ", " + L("review") + ", " + L("release") + ")\n- " + L("vision") + " (" + L("personas") + ", " + L("glossary") + ")\n- " + L("design") + " (" + L("a11y") + ")\n- " + L("adrs") + " (" + L("adr1") + ", " + L("adr3") + ")"), 60);
  const legacyPlan = md("# v1 itinerary sunset plan", "Draft. Plan to retire the v1 itinerary endpoints (" + w("PLAT-7") + ") in three steps: announce, warn with a header, remove. Target removal: end of the quarter.", "Open: which partners still call v1?");
  await make({ key: "sunset", name: "v1 itinerary sunset plan", who: "user", space: "PLAT", icon: "Flag", color: "gray", labels: ["Design doc"], body: legacyPlan });
  await make({ key: "inventory", name: "v1 client inventory", parent: "sunset", who: "user", icon: "Package", color: "gray", body: md("# v1 client inventory", "Eleven partners still call v1. The three largest make 82% of the calls.", "| Client | Calls per day | Owner | Moved to v2 |\n|---|---|---|---|\n| Partner A (flight bundles) | 41,200 | unassigned | no |\n| Partner B (travel agency) | 28,900 | unassigned | no |\n| Partner C (corporate tool) | 12,300 | unassigned | partly |\n| Eight smaller partners | 18,100 | partnerships | 3 of 8 |", "Source: gateway logs, last 14 days.") });

  await drainBurn(clock, 11);

  // ---------------------------------------------------------------- day 10: agents contribute
  clock.at(10, 9, 15);
  await edit("oncall", "user", md(oncall, "## Severity", "| Level | Meaning | Who is told |\n|---|---|---|\n| 1 | Bookings or payments down | Everyone, phone call |\n| 2 | One feature down, workaround exists | Team channel |\n| 3 | Degraded, nobody blocked | Ticket only |"), 10);
  await edit("glossary", "user", md(glossary, "Answer: keep both. *Trip* is what the traveller owns, *itinerary* is only the list inside it. Add this to the writing guide."), 70);
  const notesHead = (status: string) => md("# Release notes 4.12", status);
  const notesFixed = md("## Fixed", "- Search results no longer flicker while typing.\n- Pull to refresh on the trips list.", "## Faster", "- Cold start on a mid-range Android phone: p50 from 2.4 s to 1.3 s, p90 2.2 s (" + w("MOB-6") + ").");
  await make({ key: "notes412", name: "Release notes 4.12", who: "release", space: "MOB", icon: "Rocket", color: "orange", labels: ["Release"], body: md(notesHead("Rolling out to 10% today. Cut from `release/4.12` with 212 commits."), notesFixed, "## Known issues", "- Rotating the phone while the map loads closes the app on Android 15 (" + w("MOB-3") + "). A fix is in progress.\n- Timeline redesign (" + w("MOB-4") + ") is behind a flag and not in this release.") });
  const webhooksV1 = md("# Webhook delivery contract", "Written alongside the implementation of " + w("PLAT-3") + ". Events: `booking.confirmed`, `booking.changed`, `booking.cancelled`, `booking.ticketed`.", "## Payload", fence("json", `{\n  "id": "evt_01HZX8",\n  "type": "booking.changed",\n  "created": "${eventTime(-1)}",\n  "data": { "booking_id": "bk_3318", "status": "rescheduled" }\n}`), "## Retries", "| Attempt | Delay |\n|---|---|\n| 1 | immediately |\n| 2 | 1 min |\n| 3 | 5 min |\n| 4 | 30 min |\n| 5 | 2 h |\n| 6 | 12 h, then the delivery is marked failed |", "Each request is signed with `X-Orbit-Signature` (HMAC-SHA256 over the raw body and the `X-Orbit-Timestamp` header).");
  await make({ key: "webhooks", name: "Webhook delivery contract", who: "coder", space: "PLAT", icon: "Lightning", color: "yellow", labels: ["Design doc"], body: webhooksV1 });
  clock.at(10, 14, 20);
  const incident = md("# Incident review: export timeouts", "Impact: the nightly partner export did not finish on " + dayLabel(-3) + " and " + dayLabel(-2) + ". Nine partners received yesterday's data. No bookings were affected. Work: " + w("PLAT-5") + ".", "## Timeline", "| Time | Event |\n|---|---|\n| 02:00 | Export starts |\n| 04:30 | Alert fires: not finished |\n| 04:41 | On-call finds the query holding a lock |\n| 05:10 | Export restarted by hand |\n| 06:25 | Finished, partners notified |", "## Actions", "- [ ] Add the missing index on `segments(booking_id, updated_at)`\n- [ ] Page on slow export steps, not only on the end time\n- [ ] Put a trace ID in every export log line (" + w("PLAT-8") + ")");
  await make({ key: "incident", name: "Incident review: export timeouts", who: "user", space: "PLAT", icon: "Bug", color: "red", labels: ["Incident"], body: incident });
  const passkeysV1 = md("# Passkeys rollout plan", "Work: " + w("MOB-5") + ".", "| Phase | Who | Success looks like |\n|---|---|---|\n| 1. Internal | Staff | 50 people signed in, no support tickets |\n| 2. Opt-in | 5% of new sign-ups | Sign-in success above 98% |\n| 3. Default | All new sign-ups | Password reset requests down by half |", "- [x] Server accepts passkey registration\n- [ ] Fallback to email code when no biometric\n- [ ] Recovery flow reviewed by support");
  await make({ key: "passkeys", name: "Passkeys rollout plan", who: "user", space: "MOB", icon: "Target", color: "purple", labels: ["Design doc"], body: passkeysV1 });
  await make({ key: "status", name: "Component status", who: "docs", space: "DSN", icon: "Cube", color: "teal", labels: ["Reference"], body: md("# Component status", "| Component | Status | Owner | Notes |\n|---|---|---|---|\n| Button | stable | Design system | Focus ring fails contrast (" + w("DSN-3") + ") |\n| Text field | stable | Design system | Error states in progress (" + w("DSN-6") + ") |\n| Date range picker | in progress | Design system | " + w("DSN-2") + " |\n| Bottom sheet | beta | Mobile | Needs reduce-motion variant |\n| Icon set | v2, v3 planned | Design | " + w("DSN-4") + " |") });
  await edit("release", "docs", md(releaseV1, "## Channels", "| Channel | Audience | Who moves it forward |\n|---|---|---|\n| Internal | Staff | release-bot after green regression |\n| Beta | 500 testers | release-bot after 24 h without a crash spike |\n| Production | Everyone | " + me + " approves the 10% step |", "Notes for each release go on a project page, for example " + L("notes412") + "."), 35);
  await edit("tokens", "docs", md(tokens, "## Status", "- [x] Surface and text tokens mapped\n- [ ] Chart palette in dark mode\n- [ ] Elevation shadows replaced by borders"), 25);
  await edit("rate", "coder", md(rate, "## Implementation", "The shared cache holds one hash per key. The check and the refill run as one atomic script, so two requests can never spend the same token:", fence("ts", "const bucket = cache.read(key); // { tokens, updatedAt }\nconst refill = (now - bucket.updatedAt) * (limitPerMinute / 60_000);\nconst tokens = Math.min(burst, bucket.tokens + refill);\nif (tokens < 1) return false;\ncache.write(key, { tokens: tokens - 1, updatedAt: now });\nreturn true;"), "Open question for " + me + ": do webhooks count against the partner tier?"), 30);

  await drainBurn(clock, 10);

  // ---------------------------------------------------------------- day 9: second round of edits
  clock.at(9, 9, 40);
  const offlineV2 = md(offline, "## Implementation notes", "The device keeps a local database with one table per entity and a `dirty` flag:", fence("sql", "CREATE TABLE segment (\n  id TEXT PRIMARY KEY,\n  trip_id TEXT NOT NULL,\n  payload TEXT NOT NULL,\n  edited_at INTEGER NOT NULL,\n  dirty INTEGER NOT NULL DEFAULT 0\n);"), "Sync batches are capped at 200 segments so a bad connection can finish one.");
  await edit("offline", "coder", offlineV2, 5);
  await edit("offline", "user", md(offlineV2, "## Decision", "Ship read-only offline first (4.14), editing offline in 4.15. Conflict rules apply from 4.15: " + L("conflicts") + "."), 60);
  await edit("rate", "user", md(rate, "## Decision", "Webhooks do **not** count against the tier. Partner limits are reviewed every quarter.", "- [x] Tiers agreed with partnerships\n- [ ] Dashboard for 429 rates\n- [ ] Document headers in the API reference (" + w("PLAT-6") + ")"), 20);
  await edit("notes412", "release", md(notesHead("Now at 50%. Crash-free sessions: 99.4%."), notesFixed, "## Known issues", "- Rotating the phone while the map loads closes the app on Android 15 (" + w("MOB-3") + "). A fix is in progress.\n- Timeline redesign (" + w("MOB-4") + ") is behind a flag.\n- Share links (" + w("MOB-7") + ") are not in 4.12.", "Reviewed by " + me + "."), 40);
  await make({ key: "coldstart", name: "Cold start budget", who: "coder", space: "MOB", icon: "Lightning", color: "yellow", body: md("# Cold start budget", "Where the time goes on a mid-range Android phone in 4.12 (p50), and the budget " + w("MOB-6") + " sets.", "| Phase | 4.12 | Budget |\n|---|---|---|\n| Runtime init | 280 ms | 300 ms |\n| Dependency graph | 190 ms | 250 ms |\n| Local database open | 250 ms | 300 ms |\n| First frame | 580 ms | 650 ms |\n| **Total** | **1,300 ms** | **1,500 ms** |", "Measure with:", fence("bash", "./scripts/measure-cold-start.sh --runs 20 --profile mid-range-android")) });
  await edit("passkeys", "coder", md(passkeysV1, "## Test matrix", "| Device | OS | Result |\n|---|---|---|\n| Current iOS phone | iOS 17 | pass |\n| Android flagship | Android 15 | pass |\n| Android mid-range | Android 14 | fails when no screen lock is set |", "The last row blocks phase 2 until the email-code fallback ships."), 50);
  await edit("webhooks", "user", md(webhooksV1, "## Decision", "Delivery is at least once, so receivers must dedupe on `id`. Events for one booking are sent in order: a later event waits until the earlier one is delivered or failed. There is no ordering across bookings."), 75);
  await edit("incident", "coder", md(incident, "## Root cause", "The export joined `bookings` to `segments` with no index on `(booking_id, updated_at)`. After the partner import the `segments` table passed 38 million rows and the plan switched to a full scan.", fence("sql", "EXPLAIN QUERY PLAN\nSELECT * FROM segments WHERE booking_id = :id AND updated_at > :since;\n-- SCAN segments (before)  /  SEARCH segments USING INDEX idx_segments_booking_updated (after)")), 15);
  await edit("oncall", "docs", md(oncall, "## After the incident", "Write a review within three working days, using " + L("incident") + " as the template."), 45);
  await edit("tokens", "coder", md(tokens, "## Generated output", fence("css", ":root[data-theme='dark'] {\n  --surface-base: #14161B;\n  --text-primary: #F2F3F5;\n  --accent-default: #7C93F0;\n}")), 40); // hex-ok: demo page content
  await make({ key: "idem", name: "Idempotency key rules", who: "docs", space: "PLAT", icon: "Diamond", color: "cyan", body: md("# Idempotency key rules", "Applies to every payment endpoint (" + w("PLAT-4") + "). Decision: " + L("adr1") + " for the client side, this page for the server.", "1. The client sends `Idempotency-Key` (a UUID) on every `POST`.\n2. The server stores the key with the response for **24 hours**.\n3. Same key, same body: return the stored response.\n4. Same key, different body: `422 idempotency_key_reused`.\n5. A duplicate that arrives while the first request is still running waits up to 10 seconds for it; after that it gets `409` with `Retry-After: 2`.") });
  await make({ key: "adr2", name: "ADR-002: Idempotency keys on payment endpoints", parent: "adrs", who: "docs", body: md("# ADR-002: Idempotency keys on payment endpoints", "**Status:** accepted", "Written from the payments meeting notes.", "## Decision", "Every payment endpoint requires an idempotency key. Rules: " + L("idem") + ". Work: " + w("PLAT-4") + ".", "## Consequences", "- Retries after a timeout can no longer double charge.\n- Clients must persist the key until they see a final answer.") });
  await edit("review", "assistant", md(reviewList, "- [ ] If it touches payments, the idempotency rules in " + L("idem") + " still hold"), 30);

  await drainBurn(clock, 9);

  // ---------------------------------------------------------------- day 8: finishing touches
  clock.at(8, 9, 20);
  await make({ key: "feedback", name: "Contractor feedback (draft)", who: "user", space: "DSN", access: "private", icon: "Folder", color: "gray", body: md("# Contractor feedback (draft)", "Notes before I send them. Not for the team yet.", "- Delivered icons on time, but the stroke widths were inconsistent.\n- Needs a clearer brief for motion work (" + w("DSN-5") + ").") });
  await edit("conflicts", "user", md(conflicts, "## Decision", "Rule 3 stays as written. Revisit if support sees more than 5 lost edits a month."), 20);
  await edit("incident", "user", md(incident.replace("- [ ] Add the missing index", "- [x] Add the missing index"), "## Root cause", "The export joined `bookings` to `segments` with no index on `(booking_id, updated_at)`; past 38 million rows the plan became a full scan.", "Index added (12 minutes, online). The slowest step dropped from 31 to 9 minutes and most nights now finish in 44 to 52 minutes. Streaming the rows instead of holding each file in memory is tracked in " + w("PLAT-5") + "."), 30);
  await edit("status", "docs", md("# Component status", "Updated after the review. See " + L("tokens") + " for colours.", "| Component | Status | Owner | Notes |\n|---|---|---|---|\n| Button | stable | Design system | Focus ring fixed in the next release (" + w("DSN-3") + ") |\n| Text field | stable | Design system | Error states in progress (" + w("DSN-6") + ") |\n| Date range picker | in progress | Design system | " + w("DSN-2") + " |\n| Bottom sheet | beta | Mobile | Reduce-motion variant done |"), 20);
  await edit("status", "user", md("# Component status", "Updated after the review. See " + L("tokens") + " for colours.", "| Component | Status | Owner | Notes |\n|---|---|---|---|\n| Button | stable | Design system | Focus ring fixed in the next release (" + w("DSN-3") + ") |\n| Text field | stable | Design system | Error states in progress (" + w("DSN-6") + ") |\n| Date range picker | in progress | Design system | " + w("DSN-2") + " |\n| Bottom sheet | stable | Mobile | Reduce-motion variant done |\n| Icon set | v3 in progress | Design | " + w("DSN-4") + " |"), 20);
  await edit("adr3", "user", md(adr3Accepted(), "Decision taken in the design sync: both review, engineering merges."), 15);
  await edit("release", "user", md(releaseV1, "## Channels", "| Channel | Audience | Who moves it forward |\n|---|---|---|\n| Internal | Staff | release-bot after green regression |\n| Beta | 500 testers | release-bot after 24 h without a crash spike |\n| Production | Everyone | " + me + " approves the 10% step |", "## Rollback", "Halt the rollout if crash-free sessions drop below 99.0% or the one-star share doubles. Never roll back a database migration; ship a fix forward.", "Hotfixes start at 5% and go to 100% after six hours without a new crash group.", "Notes for each release go on a project page, for example " + L("notes412") + "."), 25);
  await edit("handbook", "docs", md(handbookV1, "## Sections", "- " + L("eng") + " (" + L("oncall") + ", " + L("review") + ", " + L("release") + ")\n- " + L("vision") + " (" + L("personas") + ", " + L("glossary") + ")\n- " + L("design") + " (" + L("a11y") + ")\n- " + L("adrs") + " (" + L("adr1") + ", " + L("adr2") + ", " + L("adr3") + ")", "Reviewed this week by " + me + ". Release, ADR-001 and ADR-002 are locked."), 20);
  await edit("sunset", "docs", md(legacyPlan, "Superseded: v1 traffic is now handled by the deprecation tracker on " + w("PLAT-7") + "."), 15);

  // Lifecycle: update labels on an existing page, lock the settled pages, archive the outdated pair.
  clock.step(10);
  await run(actors.user, "update_page", { page_id: made.get("coldstart")!.id, label_ids: [labelIds.get("MOB:Design doc")!] });
  count.labelled_pages++;
  await pageOp("lock_page", "user", "release");
  await pageOp("lock_page", "user", "adr1");
  await pageOp("lock_page", "user", "adr2");
  count.locked = 3;
  await pageOp("archive_page", "user", "sunset");
  count.archived = 2;
  return count;
}

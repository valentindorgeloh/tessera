/**
 * Showcase demo, core part (clock window 21 to 12 days ago): the four Orbit projects with their states, labels,
 * estimates, modules, cycles, about a hundred work items, archives, views and the archived LEG project. Items are
 * created over a week (projects start on days 21, 20 and 19) and walked through their states on their own days, so
 * created and completed times differ by days and burndowns fall steadily. Changes planned for days after this part's
 * window are queued (`queueBurn`) and replayed by the later parts (`drainBurn`).
 */
import type { TesseraContext } from "@/lib/tessera/core/context";
import { addDays } from "@/lib/tessera/core/time";
import type { PaletteColor, Priority } from "@/lib/tessera/types";
import type { ToolInput } from "@/lib/tessera/tools/registry";
import { DEMO_ANCHORS, DEMO_PROJECTS, queueBurn, resetBurn, run, type DemoActors, type DemoClock } from "./shared";

type Who = "u" | "a" | "r" | "t" | "c" | "d"; // user, assistant, release-bot, triage-agent, claude-code, docs-writer
type Cyc = "done" | "cur" | "up" | "draft" | "old";
type Meta = { s: string; p?: Priority; l?: string[]; a?: Who[]; e?: string; st?: number; tg?: number; c?: Cyc; m?: string[]; d?: string };
type Item = Meta & { n: string; par?: string; ref?: string; by?: Who; x?: Who; arch?: true };
type ModSpec = { n: string; d: string; s: "backlog" | "planned" | "in_progress" | "paused" | "completed"; lead: Who; mem: Who[]; st: number; tg: number; link?: [string, string] };
type Features = NonNullable<ToolInput<"create_project">["features"]>;
type Spec = {
  key: "MOB" | "PLAT" | "DSN"; about: string; logo: { icon: string; color: PaletteColor }; features: Features;
  est: { name: string; type: "points" | "categories" | "time"; values: string[] }; review: boolean;
  labels: [string, PaletteColor, string?][]; modules: ModSpec[]; cyc?: Partial<Record<Cyc, [string, string, number?, number?]>>;
  anchors: Meta[]; items: Item[];
};
type Move = { day: number; pass: 0 | 1 | 2; state: string; who: Who };
type Made = { it: Item; id: string; moves: Move[] };
type Built = { spec: Spec; id: string; states: Map<string, string>; labels: Map<string, string>; points: Map<string, string>; modules: Map<string, string>; cycles: Partial<Record<Cyc, string>>; made: Made[] };

const md = (...parts: string[]) => parts.join("\n\n");
const ALL_ON = { cycles_enabled: true, modules_enabled: true, views_enabled: true, pages_enabled: true, intake_enabled: true, estimates_enabled: true };

const MOB: Spec = {
  key: "MOB", about: "\n\nOwners: the mobile team. Releases ship every second Tuesday; hotfixes go to 5% of users first.", logo: { icon: "Rocket", color: "blue" },
  features: { ...ALL_ON, agent_intake_required: true }, review: true,
  est: { name: "Fibonacci points", type: "points", values: ["1", "2", "3", "5", "8", "13"] },
  labels: [["Bug", "red"], ["Crash", "orange", "Bug"], ["Feature", "blue"], ["Design", "pink"], ["Accessibility", "purple", "Design"], ["Performance", "yellow"], ["iOS", "cyan"], ["Android", "green"], ["Tech debt", "gray"]],
  modules: [
    { n: "Offline and sync", d: "Everything needed to use a saved trip without a connection.", s: "in_progress", lead: "u", mem: ["u", "c"], st: -20, tg: 14, link: ["Offline design notes", "https://orbit.example/design/offline-trips"] },
    { n: "Passkeys and accounts", d: "Passwordless sign-in and account recovery.", s: "planned", lead: "u", mem: ["u", "c", "a"], st: 3, tg: 30, link: ["Passkey rollout plan", "https://orbit.example/specs/passkeys"] },
    { n: "Trip timeline", d: "The redesigned itinerary screen.", s: "in_progress", lead: "u", mem: ["u", "d"], st: 2, tg: 21 },
    { n: "Accessibility push", d: "Audit findings and fixes before the next fare-class launch.", s: "paused", lead: "u", mem: ["u"], st: 4, tg: 25 },
  ],
  cyc: { old: ["Sprint 22", "Housekeeping before the offline work started.", -35, -22], done: ["Sprint 23", "Offline groundwork, search polish and the cold start target.", -21, -14], cur: ["Sprint 24", "Offline downloads, the Android crash and notification permissions.", -13, 1], up: ["Sprint 25", "Passkeys, the timeline redesign and the first accessibility fixes.", 2, 15], draft: ["Q4 ideas", "Unscheduled candidates for the end of the quarter."] },
  anchors: [
    { s: "In Progress", p: "high", l: ["Feature"], a: ["u"], e: "8", c: "cur", m: ["Offline and sync"], st: -9, tg: 7,
      d: md("## Context\nTravellers lose signal in airports, on trains and abroad, and the app shows a spinner instead of their booking. Saved trips should open instantly with no connection.", "## Scope\n- Cache the itinerary, bookings, tickets (QR codes) and the last 30 days of notifications on the device\n- Download map tiles for the trip's cities (about 40 MB per city), on Wi-Fi only\n- Queue edits made offline and replay them in order when the connection returns", "## Acceptance criteria\n- [x] A trip saved while online opens in airplane mode in under 1 s\n- [x] Tickets show their QR code and booking reference offline\n- [ ] Edits made offline carry a 'Waiting to sync' badge\n- [ ] Two devices editing one trip never lose a change\n- [ ] Settings > Storage shows the space used, with a 'Clear offline data' button", "## Conflict rules\n| Field | Winner |\n|---|---|\n| Notes | Merge both versions, newest first |\n| Dates | Latest edit wins, the other device sees a banner |\n| Deleted item | Deletion wins unless it was edited afterwards |", "Depends on [MOB-6](work:MOB-6) because the cache is read at launch. Design notes: [offline trips](https://orbit.example/design/offline-trips).") },
    { s: "In Review", p: "medium", l: ["Feature"], a: ["u"], e: "3", c: "cur", st: -8, tg: 3,
      d: md("Let travellers choose what they hear about instead of the all-or-nothing switch in system settings.", "## Categories\n1. Booking changes (gate, time, cancellation): on by default, cannot be fully disabled\n2. Trip reminders (check-in opens, time to leave for the airport)\n3. Price alerts\n4. Tips and offers: off by default", "## Acceptance criteria\n- [x] Reachable from Profile > Notifications\n- [x] Each category has a toggle and a quiet-hours range (default 22:00 to 07:00)\n- [ ] Changes sync across devices within 5 s\n- [ ] A category that is off sends no push but still appears in the in-app list\n- [ ] Screen readers announce 'Price alerts, on' for each row", "API: `PUT /v2/me/notification-preferences`. Delivery rules live in [PLAT-3](work:PLAT-3).") },
    { s: "In Progress", p: "urgent", l: ["Bug", "Crash", "Android"], a: ["u"], e: "5", c: "cur", st: -6, tg: -1,
      d: md("## What happens\nRotating the phone while the map is loading closes the app. Reproduced on two phones running Android 15 (a 6.1 inch and a foldable); Android 14 is fine. 312 crashes in the last 7 days (0.9% of sessions).", "## Steps to reproduce\n1. Open any trip with 5+ places and tap **Map**\n2. Rotate to landscape while the tiles are still loading\n3. The app closes with no error dialog", "```\njava.lang.IllegalStateException: Surface has been released\n  at com.orbit.map.TileRenderer.draw(TileRenderer.kt:212)\n  at com.orbit.map.MapView.onSizeChanged(MapView.kt:88)\n```", "## Likely cause\nThe render thread outlives the surface when the activity is recreated.", "## Fix checklist\n- [x] Reproduce on a device farm\n- [ ] Stop the render thread in `surfaceDestroyed`\n- [ ] Regression test that rotates 20 times during load\n- [ ] Roll out to 5% of Android 15 users first") },
    { s: "Todo", p: "high", l: ["Design"], a: ["u"], e: "13", c: "up", m: ["Trip timeline"], st: 2, tg: 14,
      d: md("The timeline is the screen people open most (68% of sessions) and the one with the lowest rating. Redesign it around what happens next instead of a flat list.", "## Goals\n- The next thing that needs action is visible without scrolling\n- Group by day and collapse days that are complete\n- Show travel time between stops", "## Decisions\n| Question | Decision |\n|---|---|\n| Layout | Vertical, one card per segment |\n| Past items | Collapsed into one 'Earlier' row |\n| Delays | Inline chip, red after 15 min |", "## Acceptance criteria\n- [ ] Prototype tested with 8 travellers\n- [ ] 60 segments scroll at 60 fps on a mid-range Android phone\n- [ ] Dark mode uses the new colour tokens from [DSN-1](work:DSN-1)") },
    { s: "Todo", p: "medium", l: ["Feature", "iOS", "Android"], a: ["c"], e: "8", c: "up", m: ["Passkeys and accounts"], st: 3, tg: 15,
      d: md("Replace passwords with passkeys on both platforms, with email codes as the fallback.", "## Flow\n1. Create account: email, verify code, 'Create a passkey' prompt (can be skipped twice)\n2. Sign in: autofill suggests the passkey, otherwise an email code\n3. New device: any signed-in device can approve a new passkey", "## Acceptance criteria\n- [ ] iOS 17+ and Android 14+ get passkeys; older versions keep email codes\n- [ ] Settings lists registered passkeys with name and last used date\n- [ ] Removing the last passkey asks for an email code first\n- [ ] 60% of new accounts create a passkey within 30 days (target)", "Auth rate limits must be agreed with [PLAT-1](work:PLAT-1).") },
    { s: "Done", p: "medium", l: ["Performance"], a: ["u"], e: "5", c: "done", st: -20, tg: -14,
      d: md("Median cold start was 2.4 s on the reference Android phone and 1.1 s on a recent iOS phone. Target: p50 under 1.5 s and p90 under 2.5 s on Android.", "## Measurements before the work\n| Phase | Android | iOS |\n|---|---|---|\n| Process start to first frame | 0.9 s | 0.4 s |\n| Auth and config fetch | 0.8 s | 0.4 s |\n| First list render | 0.7 s | 0.3 s |\n| **Total** | **2.4 s** | **1.1 s** |", "## Changes\n- [x] Defer analytics start-up until after the first frame\n- [x] Read config from disk and refresh it in the background\n- [x] Replace the 320 ms splash animation with a static image\n- [x] Lazy-load the map module", "Result in the 4.12 release candidate: p50 1.3 s, p90 2.2 s. The offline cache in [MOB-1](work:MOB-1) must keep these numbers.") },
    { s: "Backlog", p: "low", l: ["Feature"], e: "5", c: "draft",
      d: md("Let travellers share their itinerary with friends and family who do not have the app.", "## Idea\nA link such as `orbit.example/t/8fK2xQ` opens a read-only web page. Owners can revoke it at any time.", "## Open questions\n- Should the page show booking references? Probably not: times and places only\n- Expiry: 30 days after the trip ends?\n- Do we need a request-to-join flow? Not in v1", "## Acceptance criteria (draft)\n- [ ] Works in a browser without installing the app\n- [ ] Revoking takes effect within 1 minute\n- [ ] A pasted link shows destination and dates in chat previews", "The offline cache in [MOB-1](work:MOB-1) must never store links shared by other people.") },
    { s: "Todo", p: "high", l: ["Accessibility"], a: ["u"], e: "3", c: "up", m: ["Accessibility push"], st: 4, tg: 12,
      d: md("Before the next fare-class launch we need a full audit of search, select, pay and confirmation.", "## Checklist\n- [ ] Screen reader pass on iOS and Android\n- [ ] Text scaling at 200% on every screen\n- [ ] Contrast of at least 4.5:1 for body text; the focus ring is tracked in [DSN-3](work:DSN-3)\n- [ ] Touch targets of 44 x 44 pt or more\n- [ ] Errors are announced and linked to their field\n- [ ] Reduced motion setting respected", "## Output\nA findings list with severity (blocker, major, minor), one work item per finding, and a re-test after the fixes.") },
  ],
  items: [
    { n: "Cache itinerary, bookings and tickets in the local database", par: "1", s: "Done", p: "high", l: ["Feature"], a: ["u"], e: "3", c: "done", m: ["Offline and sync"], st: -20, tg: -15, d: "Schema v7 adds `trip_cache` and `ticket_cache`. Entries are encrypted at rest and expire 14 days after the trip ends." },
    { n: "Download map tiles per city on Wi-Fi", par: "1", s: "In Progress", l: ["Android", "iOS"], a: ["c"], e: "5", c: "cur", m: ["Offline and sync"], st: -8, tg: 4, d: "- [x] Tile packs for the 40 most visited cities\n- [ ] Resume interrupted downloads\n- [ ] Pause on low battery" },
    { n: "Queue offline edits and replay them on reconnect", par: "1", s: "In Progress", a: ["u"], e: "8", c: "done", m: ["Offline and sync"], st: -14, tg: 7, d: "Edits are stored as operations with a device id and a counter, and replayed in order." },
    { n: "Sync conflict banner and resolution sheet", par: "1", s: "Todo", p: "medium", l: ["Design"], e: "3", c: "up", m: ["Offline and sync"], st: 3, tg: 12 },
    { n: "Collapse finished days into an Earlier row", par: "4", s: "Todo", l: ["Design"], a: ["u"], e: "3", c: "up", m: ["Trip timeline"], st: 3, tg: 9 },
    { n: "Inline delay chip on flight cards", par: "4", s: "Backlog", p: "low", e: "2", m: ["Trip timeline"] },
    { n: "Show travel time between stops", par: "4", s: "Backlog", p: "low", e: "5", m: ["Trip timeline"] },
    { n: "Passkey registration screen", par: "5", s: "Todo", l: ["iOS", "Android"], a: ["c"], e: "3", c: "up", m: ["Passkeys and accounts"], st: 4, tg: 9 },
    { n: "Email code fallback when no passkey exists", par: "5", s: "Backlog", e: "2", m: ["Passkeys and accounts"] },
    { n: "Fix wrong time zone on hotel check-in cards", s: "Done", p: "high", l: ["Bug"], a: ["u"], e: "2", c: "done", st: -19, tg: -16, arch: true, d: "Check-in times used the phone's zone instead of the hotel's. Now read from the booking's `tz` field." },
    { n: "Currency symbol missing for Japanese yen prices", s: "Done", p: "low", l: ["Bug"], a: ["u"], e: "1", c: "done", arch: true },
    { n: "Search results flicker while typing", s: "Done", p: "medium", l: ["Bug", "Performance"], a: ["u"], e: "3", c: "done", st: -18, tg: -14, d: "Debounce of 150 ms and keep the previous results visible until the new ones arrive." },
    { n: "Android back button closes the app from trip details", s: "Done", p: "medium", l: ["Bug", "Android"], a: ["u"], e: "2", c: "cur", st: -9, tg: -4 },
    { n: "Ask for notification permission after the first trip, not on launch", s: "In Review", p: "high", l: ["Feature"], a: ["u"], e: "2", c: "cur", st: -7, tg: 1, d: "Launch prompt accepts 31% of the time; a prompt after the first saved trip should do better. Settings live in [MOB-2](work:MOB-2)." },
    { n: "Crash-free sessions below 99.5% on iOS 18.1", s: "In Progress", p: "urgent", l: ["Bug", "Crash", "iOS"], a: ["c"], e: "5", c: "cur", st: -4, tg: 1, d: "Top crash: force unwrap of a missing `departure` in the widget extension. 1,140 sessions in 7 days." },
    { n: "Widget: show gate and boarding time", s: "Todo", p: "medium", l: ["Feature", "iOS"], e: "5", c: "up", st: 5, tg: 14, d: "The next-flight widget only shows the departure time. Add the gate and the boarding time, and refresh them when the airline changes either." },
    { n: "Reduce APK size by 12 MB", s: "Todo", l: ["Performance", "Android"], a: ["u"], e: "5", c: "up", st: 3, tg: 13, d: "Current size 58 MB. Biggest wins: split ABI bundles (-7 MB), drop the unused font weights (-2 MB)." },
    { n: "Upgrade the maps SDK to the current major version", s: "Todo", l: ["Tech debt"], e: "5", c: "draft" },
    { n: "Replace the deprecated share sheet API on iOS", s: "Backlog", p: "low", l: ["Tech debt", "iOS"], c: "draft" },
    { n: "Biometric lock for saved tickets", s: "Backlog", p: "medium", l: ["Feature"], e: "8" },
    { n: "Dark map style for night use", s: "Backlog", p: "low", l: ["Design"], e: "3" },
    { n: "Pull to refresh on the trips list", s: "Done", p: "low", l: ["Feature"], a: ["u"], e: "1", c: "cur", st: -7, tg: -3 },
    { n: "Test date ranges around daylight saving changes", s: "Done", l: ["Tech debt"], a: ["u"], e: "3", c: "cur", st: -10, tg: -6 },
    { n: "Currency selector forgets the last choice", s: "In Progress", p: "medium", l: ["Bug"], a: ["u"], e: "2", c: "cur", st: -3, tg: 3 },
    { n: "Keyboard covers the passenger name field on small phones", s: "Done", p: "medium", l: ["Bug", "Android"], a: ["u"], e: "2", c: "cur", st: -9, tg: -5, d: "On phones under 5.5 inches the keyboard hides the field being edited. Scroll it into view and keep the Continue button visible." },
    { n: "Loading skeleton for the trip details screen", s: "Done", p: "low", l: ["Design", "Performance"], a: ["u"], e: "3", c: "cur", st: -9, tg: -3 },
    { n: "Empty state for the trips list", s: "Done", p: "low", l: ["Design"], a: ["u"], e: "1", c: "cur", st: -8, tg: -5 },
    { n: "Trim spaces around passenger names", s: "Done", p: "low", l: ["Bug"], a: ["u"], e: "1", c: "cur", st: -7, tg: -4 },
    { n: "Raise the minimum supported iOS version to 16", s: "Done", p: "low", l: ["Tech debt", "iOS"], a: ["u"], e: "2", c: "old", st: -34, tg: -24 },
    { n: "Remove the retired beta banner", s: "Done", p: "low", l: ["Design"], a: ["u"], e: "1", c: "old", st: -33, tg: -25 },
    { n: "Tablet landscape layout", s: "Cancelled", p: "low", l: ["Design"], d: "Dropped: tablets are 1.2% of sessions and the phone layout scales acceptably." },
    { n: "Calendar export of the itinerary (ICS)", s: "Backlog", p: "medium", l: ["Feature"], e: "3" },
  ],
};

const PLAT: Spec = {
  key: "PLAT", about: "\n\nOn call rotation: weekly, two engineers. Every change ships behind a flag when it touches payments.", logo: { icon: "Gear", color: "teal" },
  features: { ...ALL_ON, agent_intake_required: false }, review: true,
  est: { name: "Time (minutes)", type: "time", values: ["30", "60", "120", "240", "480", "960"] },
  labels: [["Bug", "red"], ["Feature", "blue"], ["Reliability", "orange"], ["Security", "pink"], ["Performance", "yellow"], ["API", "cyan"], ["Webhooks", "teal", "API"], ["Payments", "green"], ["Docs", "gray"]],
  modules: [
    { n: "Public API v2", d: "Limits, webhooks and a generated reference for partners.", s: "in_progress", lead: "u", mem: ["u", "c", "d"], st: -15, tg: 30, link: ["API v2 proposal", "https://orbit.example/specs/api-v2"] },
    { n: "Search migration", d: "Move search to the new index with no downtime.", s: "in_progress", lead: "u", mem: ["u", "c"], st: -22, tg: 21, link: ["Runbook: index cutover", "https://orbit.example/runbooks/search-cutover"] },
    { n: "Observability", d: "Traces, dashboards and alerts for the booking path.", s: "planned", lead: "c", mem: ["u", "c"], st: 5, tg: 35 },
    { n: "Payments hardening", d: "Make payment calls safe to retry and easy to audit.", s: "completed", lead: "u", mem: ["u", "c"], st: -45, tg: -14 },
  ],
  cyc: { done: ["Cycle 41", "Idempotent payments, trace IDs and search dual-write.", -26, -14], cur: ["Cycle 42", "Rate limits, search backfill and the nightly export fix.", -13, 2], up: ["Cycle 43", "Webhooks, key rotation and the generated API reference.", 3, 16], draft: ["Unscheduled hardening", "Reliability work with no date yet."] },
  anchors: [
    { s: "In Review", p: "high", l: ["Security", "API"], a: ["u"], e: "480", c: "cur", m: ["Public API v2"], st: -8, tg: -2,
      d: md("Public API traffic doubled in a month and one partner's retry loop took search down for 11 minutes on 3 October.", "## Proposal\nToken bucket per API key with a burst allowance.\n\n| Plan | Sustained | Burst |\n|---|---|---|\n| Free | 60 / min | 120 |\n| Partner | 600 / min | 1,200 |\n| Internal | unlimited | n/a |\n\nReturn `429` with `Retry-After` and the headers `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`.", "## Acceptance criteria\n- [x] Limits are configured per key, not in code\n- [x] Counters live in the shared cache; if it is down we fail open and alert\n- [ ] Load test: 5,000 req/s across 200 keys, p99 overhead under 3 ms\n- [ ] Dashboard shows throttled requests per key\n- [ ] Reference updated in [PLAT-6](work:PLAT-6)") },
    { s: "In Progress", p: "high", l: ["Performance"], a: ["u", "c"], e: "960", c: "cur", m: ["Search migration"], st: -10, tg: 12,
      d: md("The old search cluster is at 87% disk and a reindex takes 9 hours. The new index supports incremental updates and typo tolerance.", "## Plan\n1. Dual-write every booking and place change to both indexes\n2. Backfill the new index (about 48 million documents)\n3. Shadow reads: compare the top 10 results for 1% of queries\n4. Switch reads behind a flag: 10%, 50%, 100%\n5. Switch off the old cluster after two quiet weeks", "## Acceptance criteria\n- [ ] Top 10 overlap in shadow mode is at least 92%\n- [ ] p95 query latency under 120 ms (today 210 ms)\n- [ ] Rollback is a flag flip and takes under 2 minutes\n- [ ] Runbook reviewed by the on-call engineers") },
    { s: "Todo", p: "medium", l: ["Feature", "API", "Webhooks"], a: ["c"], e: "480", c: "up", m: ["Public API v2"], st: 3, tg: 14,
      d: md("Partners poll `/bookings` every minute. Give them push instead.", "## Events\n`booking.confirmed`, `booking.changed`, `booking.cancelled`, `booking.ticketed`", "## Payload\n```json\n{ \"id\": \"evt_01J9\", \"type\": \"booking.changed\", \"created_at\": \"2026-10-02T09:14:00Z\", \"data\": { \"booking_id\": \"bk_4821\", \"changes\": [\"departure_time\"] } }\n```", "## Acceptance criteria\n- [ ] HMAC signature header with rotating secrets\n- [ ] At-least-once delivery, five retries with exponential backoff over about 15 hours\n- [ ] Partners can see a delivery log for the last 30 days\n- [ ] Ordering is documented: per booking, not global") },
    { s: "Done", p: "urgent", l: ["Payments", "Reliability"], a: ["u"], e: "480", c: "done", m: ["Payments hardening"], st: -25, tg: -15,
      d: md("A mobile retry after a timeout charged 14 customers twice last month.", "## Behaviour\n- `Idempotency-Key` header required on `POST /payments` and `POST /refunds`\n- Same key and same body within 24 h returns the original response\n- Same key with a different body returns `422 idempotency_key_reused`", "## Acceptance criteria\n- [x] Keys are stored with a hash of the request body\n- [x] Concurrent duplicates wait for the first request (10 s at most) and never run twice\n- [x] Tests cover timeout, retry and conflicting bodies\n- [x] The mobile queue in [MOB-1](work:MOB-1) sends one key per user action", "Shipped in platform 2026.10.1.") },
    { s: "In Progress", p: "high", l: ["Bug", "Reliability"], a: ["u"], e: "240", c: "cur", st: -9, tg: -3,
      d: md("The partner export (CSV, about 2.1 GB) fails around 03:40 with `context deadline exceeded`, three nights a week.", "## Findings\n| Night | Duration | Result |\n|---|---|---|\n| Mon | 58 min | timeout |\n| Tue | 41 min | ok |\n| Wed | 61 min | timeout |\n\nThe slowest step is the join on `segments`, which lacks an index on `(booking_id, updated_at)`.", "## Plan\n- [x] Add the index (online, 12 min)\n- [ ] Stream rows instead of holding each partner file in memory\n- [ ] Raise the job timeout from 60 to 90 min as a safety net\n- [ ] Alert when the job runs longer than 45 min") },
    { s: "Todo", p: "low", l: ["Docs", "API"], a: ["d"], e: "240", c: "up", m: ["Public API v2"], st: 4, tg: 12,
      d: md("The hand-written reference is three releases behind. Generate it from the OpenAPI schema on every release.", "- [ ] Publish to the docs site on merge to main\n- [ ] Each endpoint shows an example request and response\n- [ ] Errors are listed per endpoint with their codes\n- [ ] A changelog page lists added, changed and removed fields\n- [ ] Broken links fail the build", "Guides stay separate from the reference for now.") },
    { s: "Backlog", p: "medium", l: ["API"], a: ["u"], e: "960", st: 14, tg: 42,
      d: md("v1 still serves 4% of traffic from 11 partners.", "## Timeline\n| When | Step |\n|---|---|\n| Week 0 | Announce, add `Deprecation` and `Sunset` headers |\n| Week 4 | Brownouts: one hour per week |\n| Week 8 | Shut down |", "- [ ] Partner list with an owner for each\n- [ ] Migration guide with a request mapping\n- [ ] Dashboard of v1 callers by key") },
    { s: "Done", p: "medium", l: ["Reliability"], a: ["c"], e: "120", c: "done", st: -24, tg: -16,
      d: md("Support cannot follow a failed booking across services.", "- [x] Create a `trace_id` at the edge when the client sends none\n- [x] Propagate it through queue messages and background jobs\n- [x] Add it to every structured log line and to `error.trace_id` in responses\n- [x] Document it in the runbook", "Format: `trace_id=7f3a9c1e2b4d`. Search the logs for it to see the whole request.") },
  ],
  items: [
    { n: "Store a hash of the request body with each idempotency key", par: "4", s: "Done", p: "high", l: ["Payments"], a: ["c"], e: "120", c: "done", m: ["Payments hardening"], st: -24, tg: -18, d: "The hash is SHA-256 over the canonical JSON body. A key seen again with a different hash is a conflict, never a replay." },
    { n: "Make concurrent duplicates wait for the first request", par: "4", s: "Done", p: "high", l: ["Payments", "Reliability"], a: ["c"], e: "240", c: "done", m: ["Payments hardening"], st: -23, tg: -17, d: "A second request with the same key waits up to 10 s for the first to finish, then returns its response. After 10 s it gets `409` with `Retry-After: 2`." },
    { n: "Keep refund keys for 72 hours", par: "4", s: "Todo", p: "low", l: ["Payments"], a: ["c"], e: "120", m: ["Payments hardening"], d: "Banks can take two days to answer a refund. Payments stay at 24 hours. Waiting for approval." },
    { n: "Dual-write bookings and places to both indexes", par: "2", s: "Done", p: "high", a: ["c"], e: "480", c: "done", m: ["Search migration"], st: -22, tg: -15 },
    { n: "Backfill the new index", par: "2", s: "In Progress", p: "high", a: ["c"], e: "960", c: "done", m: ["Search migration"], st: -14, tg: 2, d: "Backfill runs at 3,000 documents/s; 61% done. Pauses automatically when query latency exceeds 150 ms." },
    { n: "Shadow-read comparison dashboard", par: "2", s: "In Progress", a: ["u"], e: "240", c: "cur", m: ["Search migration"], st: -2, tg: 6 },
    { n: "Feature flag and gradual switch of read traffic", par: "2", s: "Todo", a: ["u"], e: "240", c: "up", m: ["Search migration"], st: 3, tg: 12 },
    { n: "Signing and secret rotation for webhook payloads", par: "3", s: "Todo", l: ["Security", "Webhooks"], a: ["c"], e: "240", c: "up", m: ["Public API v2"], st: 3, tg: 8 },
    { n: "Retry queue with exponential backoff", par: "3", s: "Todo", l: ["Webhooks"], a: ["c"], e: "480", c: "up", m: ["Public API v2"], st: 6, tg: 13 },
    { n: "Partner-facing delivery log", par: "3", s: "Backlog", l: ["Webhooks"], e: "480", m: ["Public API v2"] },
    { n: "Add retry with backoff to the payment provider client", by: "c", s: "Done", p: "high", l: ["Reliability", "Payments"], a: ["u"], e: "120", c: "done", m: ["Payments hardening"], st: -23, tg: -16, d: "Three attempts, 200 ms base delay with jitter. Only network errors and 5xx responses are retried; declines never are." },
    { n: "Flaky booking confirmation test on CI", by: "c", s: "Done", p: "medium", l: ["Bug"], a: ["u"], e: "60", c: "cur", st: -9, tg: -4, d: "Fails about 1 run in 12. The test sends the confirmation email before the outbox row is committed." },
    { n: "Upgrade the runtime to the current LTS", by: "c", s: "Backlog", p: "low", l: ["Reliability"], a: ["u"], e: "480", d: "Current version leaves security support in 4 months. No breaking changes expected in our dependencies." },
    { n: "Rollback script for failed schema migrations", by: "r", s: "Todo", p: "high", l: ["Reliability"], a: ["u"], e: "240", c: "cur", st: 0, tg: 5, d: "Two of the last five releases needed a manual rollback. The script must restore the previous schema version and verify row counts." },
    { n: "Release checklist misses the cache warm-up step", by: "r", s: "Done", x: "r", p: "medium", l: ["Docs"], a: ["u"], e: "30", c: "done", st: -20, tg: -17 },
    { n: "Tag releases and post notes when a deploy finishes", s: "Done", x: "r", p: "low", l: ["Reliability"], a: ["u"], e: "120", c: "cur", st: -9, tg: -2 },
    { n: "Slow query on the bookings list endpoint", s: "In Review", x: "c", p: "high", l: ["Bug", "Performance"], a: ["u", "c"], e: "240", c: "done", st: -12, tg: 1, d: "p95 is 1.8 s for partners with more than 10,000 bookings. The sort falls back to a file sort." },
    { n: "Alert when the payment error rate exceeds 2%", s: "In Progress", p: "urgent", l: ["Reliability", "Payments"], a: ["u"], e: "120", c: "cur", m: ["Observability"], st: -2, tg: 4 },
    { n: "Return 404 instead of 500 for unknown booking ids", s: "Done", p: "medium", l: ["Bug", "API"], a: ["u"], e: "60", c: "cur", m: ["Public API v2"], st: -9, tg: -6 },
    { n: "Log database queries slower than 500 ms", s: "Done", p: "medium", l: ["Reliability"], a: ["c"], e: "120", c: "cur", m: ["Observability"], st: -8, tg: -4 },
    { n: "Raise the search connection pool limit from 20 to 50", s: "Done", p: "low", l: ["Performance"], a: ["u"], e: "30", c: "cur", m: ["Search migration"], st: -7, tg: -5 },
    { n: "Dashboards for p95 latency per endpoint", s: "Todo", p: "medium", l: ["Reliability"], e: "480", c: "up", m: ["Observability"], st: 6, tg: 16 },
    { n: "Rotate the signing keys for partner tokens", s: "Todo", p: "high", l: ["Security"], a: ["u"], e: "120", c: "up", st: 4, tg: 10 },
    { n: "Return a Retry-After header on 503 responses", s: "Done", p: "medium", l: ["API", "Reliability"], a: ["u"], e: "60", c: "done", m: ["Public API v2"], arch: true },
    { n: "Pagination cursor breaks when a booking is edited", s: "In Progress", p: "high", l: ["Bug", "API"], a: ["c"], e: "240", c: "cur", m: ["Public API v2"], st: -2, tg: 3, d: "Cursors encode `updated_at`, so an edited booking can be skipped or repeated. Switch to a stable `(id)` cursor." },
    { n: "Remove unused fare cache tables", s: "Backlog", p: "low", l: ["Reliability"], e: "120", c: "draft" },
    { n: "Support multi-currency totals on invoices", s: "Backlog", p: "medium", l: ["Feature", "Payments"], e: "960" },
    { n: "Customer reported duplicate confirmation emails", s: "Cancelled", p: "medium", l: ["Bug"], d: "Not reproducible after the idempotency work in [PLAT-4](work:PLAT-4); no further reports in two weeks." },
    { n: "Document error codes for the payment endpoints", s: "Todo", p: "medium", l: ["Docs", "Payments"], a: ["d"], e: "240", c: "up", st: 5, tg: 13 },
    { n: "Security review of the partner token scopes", s: "In Progress", p: "high", l: ["Security", "API"], a: ["u"], e: "480", c: "cur", m: ["Public API v2"], st: -4, tg: 3 },
    { n: "Fix time zone drift in the nightly export", s: "Done", p: "medium", l: ["Bug", "Reliability"], a: ["u"], e: "120", c: "done", arch: true, d: "Timestamps were written in the server's local zone. Exports now use UTC with an explicit offset." },
  ],
};

const DSN: Spec = {
  key: "DSN", about: "\n\nTokens are the source of truth; components consume them and never hard-code values.", logo: { icon: "Diamond", color: "purple" },
  features: { ...ALL_ON, cycles_enabled: false, agent_intake_required: false }, review: true,
  est: { name: "T-shirt sizes", type: "categories", values: ["XS", "S", "M", "L", "XL"] },
  labels: [["Tokens", "purple"], ["Component", "blue"], ["Breaking change", "red", "Component"], ["Accessibility", "pink"], ["Docs", "gray"], ["Bug", "orange"], ["Motion", "yellow"], ["Design library", "cyan"]],
  modules: [
    { n: "Foundations", d: "Colour, type and spacing tokens, and how they reach the code.", s: "in_progress", lead: "u", mem: ["u", "c"], st: -14, tg: 21, link: ["Token naming rules", "https://orbit.example/design/token-naming"] },
    { n: "Components 2.0", d: "The next generation of inputs, pickers and overlays.", s: "planned", lead: "u", mem: ["u", "c", "a"], st: 7, tg: 60 },
    { n: "Documentation site", d: "One place for guidelines, examples and the changelog.", s: "backlog", lead: "d", mem: ["u", "d"], st: 14, tg: 45 },
  ],
  anchors: [
    { s: "In Progress", p: "high", l: ["Tokens"], a: ["u"], e: "L", m: ["Foundations"], st: -7, tg: 5,
      d: md("Dark mode currently inverts light values in each app. Define semantic tokens once and let each theme map them.", "## Token layers\n| Layer | Example | Changes per theme |\n|---|---|---|\n| Primitive | `blue-500` | no |\n| Semantic | `surface-raised`, `text-muted` | yes |\n| Component | `button-bg-primary` | via semantic |", "## Acceptance criteria\n- [x] Semantic names agreed with the app teams\n- [ ] Every semantic token has a light and a dark value\n- [ ] All pairs used for text meet 4.5:1 (large text 3:1)\n- [ ] Mobile consumes the tokens in [MOB-4](work:MOB-4) first\n- [ ] Migration guide lists every renamed token") },
    { s: "In Progress", p: "medium", l: ["Component"], a: ["u"], e: "L", m: ["Components 2.0"], st: -10, tg: 4,
      d: md("A range picker for search, filters and reports that works with keyboard, touch and screen readers.", "## Behaviour\n- Two months side by side on wide screens, one on narrow\n- Typing a date is always possible: `2026-11-03` or `3 Nov`\n- Preset ranges: last 7 days, this month, next 30 days\n- Disabled dates explain why in a tooltip", "## Acceptance criteria\n- [x] Arrow keys move by day, Page Up/Down by month\n- [x] Range is announced as 'from 3 November to 9 November'\n- [ ] Works across daylight saving changes\n- [ ] 100% of the props documented with examples") },
    { s: "Done", p: "high", l: ["Accessibility", "Bug"], a: ["u"], e: "XS", st: -14, tg: -6,
      d: md("The focus ring on primary buttons is `blue-300` on `blue-500`, a contrast of 1.4:1. WCAG asks for 3:1 against the adjacent colour.", "## Fix\n- [x] Use a two-colour ring: 2 px inner in the surface colour, 2 px outer in the accent\n- [x] Test on light, dark and high-contrast themes\n- [x] Visual regression snapshots updated", "Also covers the destructive and ghost variants. See [MOB-8](work:MOB-8) for the app audit.") },
    { s: "Backlog", p: "low", l: ["Design library"], e: "XL",
      d: md("The current set has 212 icons, three stroke widths and 31 duplicates.", "## Scope\n- Single 1.5 px stroke at 16, 20 and 24 px\n- Remove duplicates and rename by meaning (`calendar`, not `calendar-blue`)\n- Ship as an icon font fallback and as individual files", "- [ ] Audit of icons used in the apps\n- [ ] New designs for 40 missing icons\n- [ ] Codemod for renames") },
    { s: "Todo", p: "medium", l: ["Motion", "Docs"], a: ["d"], e: "M", m: ["Documentation site"],
      d: md("Write the rules for movement so every team makes the same choices.", "| Use | Duration | Easing |\n|---|---|---|\n| Hover and focus | 120 ms | ease-out |\n| Menus and tooltips | 160 ms | ease-out |\n| Dialogs | 240 ms | ease-in-out |\n| Page transitions | 320 ms | ease-in-out |", "- [ ] Reduced-motion variant for every pattern\n- [ ] Do and don't examples with short clips\n- [ ] Tokens for duration and easing") },
    { s: "In Progress", p: "high", l: ["Component", "Accessibility"], a: ["u", "c"], e: "M", m: ["Components 2.0"], st: -4, tg: 6,
      d: md("Error text is only red and sits below the field, so screen readers do not link them and colour-blind users miss it.", "## States\n1. Default\n2. Focused\n3. Error: icon, message and a red border\n4. Warning: amber, for soft limits\n5. Disabled: never used to hide errors", "- [x] Error message linked with `aria-describedby`\n- [ ] Icon plus text, never colour alone\n- [ ] Message announced when it appears\n- [ ] Shared by input, select, textarea and date range picker ([DSN-2](work:DSN-2))") },
    { s: "Todo", p: "medium", l: ["Tokens", "Design library"], a: ["c"], e: "L", m: ["Foundations"], st: 1, tg: 14,
      d: md("Designers edit tokens in the library and developers edit them in code, and they drift. Make one the source and generate the other.", "## Approach\n1. Export tokens from the design library as JSON on publish\n2. A job opens a pull request when values change\n3. CI fails if the code tokens differ from the exported file", "- [ ] Diff report that lists changed tokens\n- [ ] Runs on every library publish\n- [ ] Rollback is reverting the pull request") },
    { s: "Todo", p: "medium", l: ["Tokens"], a: ["u"], e: "S", m: ["Foundations"], st: -9, tg: -2,
      d: md("Body text at 16 px feels large on 360 px wide phones, while captions at 12 px are too small.", "| Style | Today | Proposed (under 400 px) |\n|---|---|---|\n| Body | 16 / 24 | 15 / 22 |\n| Caption | 12 / 16 | 13 / 18 |\n| Title | 24 / 32 | 22 / 28 |", "- [ ] Fluid scale with `clamp()`\n- [ ] Check the longest German and Finnish strings") },
  ],
  items: [
    { n: "Dark values for the semantic colour tokens", par: "1", s: "Done", p: "high", l: ["Tokens"], a: ["u"], e: "M", m: ["Foundations"], st: -7, tg: -3 },
    { n: "Contrast checks for every token pair", par: "1", s: "In Progress", l: ["Tokens", "Accessibility"], a: ["u"], e: "M", m: ["Foundations"], st: -3, tg: 3, d: "A script lists every text and background pair used by components and fails below 4.5:1." },
    { n: "Elevation shadows in dark mode", par: "1", s: "Todo", p: "low", l: ["Tokens"], e: "S", m: ["Foundations"] },
    { n: "Calendar grid with keyboard navigation", par: "2", s: "In Progress", p: "high", l: ["Component", "Accessibility"], a: ["u"], e: "L", m: ["Components 2.0"], st: -8, tg: 2 },
    { n: "Preset ranges for the date range picker", par: "2", s: "Todo", l: ["Component"], a: ["u"], e: "S", m: ["Components 2.0"], st: 1, tg: 5 },
    { n: "Time zone aware range selection", par: "2", s: "Backlog", l: ["Component"], e: "M", m: ["Components 2.0"] },
    { n: "Tooltip arrow misaligned at viewport edges", s: "Todo", p: "medium", l: ["Component", "Bug"], e: "XS" },
    { n: "Document the spacing scale", s: "Done", p: "low", l: ["Tokens", "Docs"], a: ["d"], e: "S", m: ["Foundations"] },
    { n: "Checkbox indeterminate state", s: "Done", l: ["Component"], a: ["u"], e: "S", arch: true },
    { n: "Toast stacking order is reversed", s: "Backlog", p: "low", l: ["Component", "Bug"], e: "S" },
    { n: "Release 2.7 changelog", s: "Done", p: "medium", l: ["Docs"], a: ["d"], e: "XS", m: ["Documentation site"] },
    { n: "Deprecate the legacy Select component", s: "Todo", p: "high", l: ["Component", "Breaking change"], a: ["u", "c"], e: "L", m: ["Components 2.0"], st: 8, tg: 28, d: "Usage: 14 imports in Mobile web, 31 in the admin tools. A codemod covers 90% of call sites." },
    { n: "Skeleton loading components", s: "Todo", p: "medium", l: ["Component"], e: "M", m: ["Components 2.0"] },
    { n: "Switch to variable fonts", s: "In Progress", p: "medium", l: ["Tokens"], a: ["c"], e: "M", m: ["Foundations"], st: -5, tg: 4, d: "Cuts the font payload from 412 KB to 138 KB. Check the weight axis against the semantic text styles." },
    { n: "Audit icon sizes across the apps", s: "Backlog", p: "low", l: ["Design library"], e: "S" },
    { n: "Tab component loses focus on remount", s: "In Progress", p: "high", l: ["Bug", "Accessibility"], a: ["u"], e: "S", st: -3, tg: 2 },
    { n: "Right-to-left support for navigation components", s: "Backlog", p: "low", l: ["Component"], e: "XL" },
    { n: "Example gallery page for each component", s: "Todo", p: "medium", l: ["Docs"], a: ["d"], e: "M", m: ["Documentation site"] },
    { n: "Reduce the bundle size of the icon package", s: "Cancelled", p: "medium", l: ["Component"], e: "M", d: "Replaced by the per-file export in [DSN-4](work:DSN-4)." },
    { n: "Publish tokens as CSS variables and JSON", s: "Done", p: "high", l: ["Tokens"], a: ["c"], e: "M", m: ["Foundations"] },
    { n: "Naming rules for component props", s: "Done", p: "low", l: ["Docs"], a: ["d"], e: "S", m: ["Documentation site"] },
    { n: "Focus order inside the dialog component", s: "Todo", p: "medium", l: ["Accessibility", "Component"], a: ["u"], e: "S", st: 2, tg: 7 },
  ],
};

const LEG_LABELS: [string, PaletteColor][] = [["Bug", "red"], ["Cleanup", "gray"], ["Data", "blue"], ["Migration", "orange"], ["Reporting", "teal"], ["Payments", "green"]];
const LEG_ITEMS: Item[] = [
  { n: "Export the last bookings table before shutdown", s: "Done", p: "high", l: ["Data", "Migration"], st: -55, tg: -40, d: "Full CSV and a checksum file, stored with the finance archive." },
  { n: "Redirect legacy URLs to the new site", s: "Done", p: "high", l: ["Migration"], st: -50, tg: -35, d: "412 redirect rules; the 20 most visited pages were checked by hand." },
  { n: "Turn off the nightly reconciliation job", s: "Done", p: "medium", l: ["Cleanup", "Payments"], st: -40, tg: -32 },
  { n: "Archive customer invoices for seven years", s: "Done", p: "medium", l: ["Data", "Reporting"], st: -48, tg: -30 },
  { n: "Remove the unused loyalty widget", s: "Cancelled", p: "low", l: ["Cleanup"], d: "Not needed once the site is switched off." },
  { n: "Final data migration check", s: "Done", p: "urgent", l: ["Data", "Migration"], st: -38, tg: -28, d: "Row counts match for bookings, customers and invoices; 3 orphaned rows were removed." },
];

// ---------------------------------------------------------------------------

const AGENT_KEY = { r: "release", t: "triage", c: "coder", d: "docs" } as const;
const ctxOf = (A: DemoActors, w: Who): TesseraContext => (w === "u" ? A.user : w === "a" ? A.assistant : A.agents[AGENT_KEY[w]]);
const need = (m: Map<string, string>, k: string): string => {
  const v = m.get(k);
  if (v === undefined) throw new Error(`demo core: unknown ${k}`);
  return v;
};

const cycleOf = (b: Built, kind: Cyc): string => {
  const id = b.cycles[kind];
  if (id === undefined) throw new Error(`demo core: ${b.spec.key} has no ${kind} cycle`);
  return id;
};

/** The core part owns days 21 to 13; state changes planned for a later day are queued for the other parts (`drainBurn`). */
const LAST_DAY = 13;
const START_DAY = { MOB: 21, PLAT: 20, DSN: 19 } as const;
const SPAN_DAYS = { MOB: 8, PLAT: 8, DSN: 7 } as const;
/** Days on which finished work of the current cycle lands, so burndowns fall steadily from the first day to the last (the collab part finishes a few more). */
const CUR_DONE_DAYS = { MOB: [13, 11, 10, 8, 6, 5, 3, 2], PLAT: [13, 11, 8, 6, 4], DSN: [13, 10, 6] } as const;
type Counters = { cur: number; other: number; started: number };

/** The day an item is created: anchors on the project's first day, the rest spread over the following week. */
function createDay(spec: Spec, k: number, anchors: number, total: number, it: Item): number {
  const first = START_DAY[spec.key];
  const day = k < anchors ? first : first - Math.floor(((k - anchors + 1) * SPAN_DAYS[spec.key]) / (total - anchors + 1));
  return it.c === "done" || it.c === "old" ? Math.max(day, 15) : day;
}

/** The state changes that walk an item from Todo or Backlog to its final state, each on its own day. */
function planMoves(it: Item, created: number, spec: Spec, n: number, ct: Counters): Move[] {
  const days: readonly number[] = CUR_DONE_DAYS[spec.key];
  const review = spec.review;
  const finisher: Who = it.x ?? "u";
  if (it.s === "Cancelled") return [{ day: Math.min(created, Math.max(LAST_DAY, created - 1 - (ct.other++ % 3))), pass: 2, state: "Cancelled", who: "u" }];
  if (it.s === "In Progress" || it.s === "In Review") {
    const k = ct.started++;
    // Every fourth item starts late (days 9 to 4), the rest in the first days of its cycle.
    const start = k % 4 === 0 ? Math.min(created, 9 - (Math.floor(k / 4) % 6)) : Math.min(created, Math.max(LAST_DAY, created - 1 - (k % 4)));
    const moves: Move[] = [{ day: start, pass: 0, state: "In Progress", who: "u" }];
    if (it.s === "In Review") moves.push({ day: start, pass: 1, state: "In Review", who: "u" });
    return moves;
  }
  if (it.s !== "Done") return [];
  const j = it.c === "cur" ? ct.cur++ : ct.other++;
  let day: number;
  if (it.c === "cur") day = days[j % days.length] ?? LAST_DAY;
  else if (it.c === "done" || it.c === "old") day = Math.max(14, created - 1 - (j % 5));
  else day = Math.max(LAST_DAY, created - 2 - (j % 4));
  day = Math.min(day, created);
  const start = Math.min(created, day + 1 + (j % 3));
  const moves: Move[] = [{ day: start, pass: 0, state: "In Progress", who: "u" }];
  if (review && n % 2 === 0) moves.push({ day: Math.min(start, day + (j % 2)), pass: 1, state: "In Review", who: "u" });
  moves.push({ day, pass: 2, state: "Done", who: finisher });
  return moves;
}

/** Project, states, labels, estimate, modules and cycles. */
async function setup(spec: Spec, A: DemoActors, clock: DemoClock, today: string, counts: Record<string, number>): Promise<Built> {
  const u = A.user;
  const info = DEMO_PROJECTS[spec.key];
  const project = await run(u, "create_project", { name: info.name, identifier: spec.key, description_md: info.description + spec.about, logo: spec.logo, features: spec.features });
  const b: Built = { spec, id: project.id, states: new Map(), labels: new Map(), points: new Map(), modules: new Map(), cycles: {}, made: [] };
  clock.step(20);
  if (spec.review) {
    const added = await run(u, "create_state", { project_id: b.id, name: "In Review", state_group: "started", color: "purple", description: "Code is written and waits for a second pair of eyes." });
    const progress = (await run(u, "list_states", { project_id: b.id })).items.find((s) => s.name === "In Progress");
    if (progress) await run(u, "reorder_state", { state_id: added.id, before_id: progress.id });
    counts.states += 1;
  }
  for (const st of (await run(u, "list_states", { project_id: b.id })).items) b.states.set(st.name, st.id);
  for (const [name, color, parent] of spec.labels) {
    const label = await run(u, "create_label", { project_id: b.id, name, color, parent_id: parent === undefined ? undefined : need(b.labels, parent) });
    b.labels.set(name, label.id);
    counts.labels += 1;
  }
  const est = await run(u, "create_estimate", { project_id: b.id, name: spec.est.name, type: spec.est.type, points: spec.est.values.map((value) => ({ value })) });
  for (const point of est.points) b.points.set(point.value, point.id);
  counts.estimates += 1;
  clock.step(15);
  for (const m of spec.modules) {
    const mod = await run(u, "create_module", { project_id: b.id, name: m.n, description_md: m.d, status: m.s, lead_actor_id: ctxOf(A, m.lead).actor.id, member_ids: m.mem.map((w) => ctxOf(A, w).actor.id), start_date: addDays(today, m.st), target_date: addDays(today, m.tg) });
    b.modules.set(m.n, mod.id);
    counts.modules += 1;
    if (m.link) {
      await run(u, "add_module_link", { module_id: mod.id, title: m.link[0], url: m.link[1] });
      counts.links += 1;
    }
    clock.step(8);
  }
  for (const [kind, c] of Object.entries(spec.cyc ?? {}) as [Cyc, [string, string, number?, number?]][]) {
    const dated = kind === "cur" || kind === "up";
    const cycle = await run(u, "create_cycle", { project_id: b.id, name: c[0], description_md: c[1], start_date: dated && c[2] !== undefined ? addDays(today, c[2]) : undefined, end_date: dated && c[3] !== undefined ? addDays(today, c[3]) : undefined });
    b.cycles[kind] = cycle.id;
    counts.cycles += 1;
    clock.step(8);
  }
  return b;
}

async function createItem(b: Built, it: Item, created: number, n: number, ct: Counters, parents: Map<string, string>, A: DemoActors, today: string, counts: Record<string, number>): Promise<void> {
  const made = await run(ctxOf(A, it.by ?? "u"), "create_work_item", {
    project_id: b.id, name: it.n, description_md: it.d, state_id: need(b.states, it.s === "Backlog" ? "Backlog" : "Todo"), priority: it.p,
    parent_id: it.par === undefined ? undefined : need(parents, it.par), cycle_id: it.c === undefined ? undefined : cycleOf(b, it.c),
    label_ids: it.l?.map((l) => need(b.labels, l)), module_ids: it.m?.map((m) => need(b.modules, m)), assignee_ids: it.a?.map((w) => ctxOf(A, w).actor.id),
    estimate_point_id: it.e === undefined ? undefined : need(b.points, it.e), start_date: it.st === undefined ? undefined : addDays(today, it.st), target_date: it.tg === undefined ? undefined : addDays(today, it.tg),
  });
  if (it.ref !== undefined) parents.set(it.ref, made.id);
  const moves = planMoves(it, created, b.spec, n, ct);
  b.made.push({ it, id: made.id, moves: moves.filter((mv) => mv.day >= LAST_DAY) });
  for (const mv of moves.filter((x) => x.day < LAST_DAY)) queueBurn({ id: made.id, stateId: need(b.states, mv.state), day: mv.day, pass: mv.pass, by: ctxOf(A, mv.who) });
  counts.queued_moves += moves.filter((x) => x.day < LAST_DAY).length;
  counts.items += 1;
  if (it.par !== undefined) counts.sub_items += 1;
  if (it.by !== undefined && it.by !== "u") counts.agent_created += 1;
}

async function makeViews(b: Built, A: DemoActors, counts: Record<string, number>): Promise<void> {
  const L = (n: string) => need(b.labels, n);
  const me = A.user.actor.id;
  const open = ["unstarted", "started"] as ("unstarted" | "started")[];
  const specs: Record<Built["spec"]["key"], () => (ToolInput<"create_view"> & { lock?: true })[]> = {
    MOB: () => [
      { project_id: b.id, name: "My open work", description: "Everything assigned to me that is not finished.", filters: { assignees: [me], state_group: open }, display: { layout: "list", group_by: "state", order_by: "priority" }, logo: { icon: "Target", color: "blue" } },
      { project_id: b.id, name: "Crashes and bugs", description: "Bugs by priority, crashes included.", filters: { labels: [L("Bug"), L("Crash")] }, display: { layout: "board", group_by: "priority", order_by: "target_date" }, logo: { icon: "Bug", color: "red" } },
      { project_id: b.id, name: "Release blockers", description: "Urgent and high priority work that must land before the next release.", filters: { priority: ["urgent", "high"], state_group: open }, display: { layout: "table", order_by: "target_date" }, logo: { icon: "Flag", color: "orange" }, lock: true },
    ],
    PLAT: () => [
      { project_id: b.id, name: "Due in the next two weeks", filters: { target_date: { op: "between", relative: "2w" }, state_group: open }, display: { layout: "calendar", calendar: { layout: "month", show_weekends: false } }, logo: { icon: "Flag", color: "yellow" } },
      { project_id: b.id, name: "Reliability and security", description: "Work that keeps the platform up and safe.", filters: { labels: [L("Reliability"), L("Security")] }, display: { layout: "board", group_by: "state" }, logo: { icon: "Lightning", color: "orange" } },
      { project_id: b.id, name: "Public API roadmap", description: "Dated work for partners.", filters: { module: [need(b.modules, "Public API v2")], start_target_date: true }, display: { layout: "gantt", gantt: { zoom: "week", show_relations: true } }, logo: { icon: "Globe", color: "cyan" }, lock: true },
    ],
    DSN: () => [
      { project_id: b.id, name: "Open accessibility work", filters: { labels: [L("Accessibility")], type: "active" }, display: { layout: "list", group_by: "priority", order_by: "priority" }, logo: { icon: "Star", color: "pink" } },
      { project_id: b.id, name: "Shipped this month", filters: { state_group: ["completed"], completed_at: { op: "between", relative: "1m" } }, display: { layout: "table", order_by: "-updated_at" }, logo: { icon: "Package", color: "green" } },
    ],
  };
  for (const { lock, ...view } of specs[b.spec.key]()) {
    const created = await run(A.user, "create_view", view);
    if (lock) await run(A.user, "lock_view", { view_id: created.id });
    counts.views += 1;
  }
}

/** LEG: a small retired project with a completed module, archived at the end of the core part. */
async function makeLegacy(A: DemoActors, clock: DemoClock, today: string, counts: Record<string, number>): Promise<string> {
  const u = A.user;
  const leg = await run(u, "create_project", { name: DEMO_PROJECTS.LEG.name, identifier: "LEG", description_md: DEMO_PROJECTS.LEG.description, logo: { icon: "Briefcase", color: "gray" }, features: { cycles_enabled: false, modules_enabled: true, views_enabled: false, pages_enabled: false, intake_enabled: false, estimates_enabled: false } });
  counts.projects += 1;
  counts.states += 5;
  const legStates = new Map((await run(u, "list_states", { project_id: leg.id })).items.map((s) => [s.name, s.id]));
  const legLabels = new Map<string, string>();
  for (const [name, color] of LEG_LABELS) {
    legLabels.set(name, (await run(u, "create_label", { project_id: leg.id, name, color })).id);
    counts.labels += 1;
  }
  const sunset = await run(u, "create_module", { project_id: leg.id, name: "Sunset", description_md: "Everything needed to switch the old site off.", status: "completed", lead_actor_id: u.actor.id, member_ids: [u.actor.id, A.agents.release.actor.id], start_date: addDays(today, -60), target_date: addDays(today, -25) });
  counts.modules += 1;
  for (const it of LEG_ITEMS) {
    clock.step(15);
    const made = await run(u, "create_work_item", { project_id: leg.id, name: it.n, description_md: it.d, state_id: need(legStates, "Todo"), priority: it.p, label_ids: it.l?.map((n) => need(legLabels, n)), module_ids: [sunset.id], assignee_ids: [u.actor.id], start_date: it.st === undefined ? undefined : addDays(today, it.st), target_date: it.tg === undefined ? undefined : addDays(today, it.tg) });
    await run(u, "update_work_item", { work_item_id: made.id, state_id: need(legStates, it.s) });
    counts.items += 1;
  }
  return leg.id;
}

export async function seedCore(actors: DemoActors, clock: DemoClock): Promise<Record<string, number>> {
  const counts: Record<string, number> = { projects: 0, states: 0, labels: 0, estimates: 0, modules: 0, cycles: 0, links: 0, items: 0, sub_items: 0, agent_created: 0, archived_items: 0, archived_cycles: 0, archived_modules: 0, relations: 0, queued_moves: 0, views: 0, workspace_views: 0 };
  const u = actors.user;
  const today = u.today();
  const specs = [MOB, PLAT, DSN];
  const builds: Built[] = [];
  const queue = new Map<Spec["key"], { it: Item; day: number; k: number }[]>();
  const parents = new Map<Spec["key"], Map<string, string>>();
  const counters = new Map<Spec["key"], Counters>();
  let legacyId = "";
  resetBurn();

  for (const spec of specs) {
    const anchors: Item[] = spec.anchors.map((meta, k) => ({ ...meta, n: DEMO_ANCHORS[spec.key][k] ?? `${spec.key} anchor ${k + 1}`, ref: String(k + 1) }));
    const all = [...anchors, ...spec.items];
    queue.set(spec.key, all.map((it, k) => ({ it, k, day: createDay(spec, k, anchors.length, all.length, it) })));
    parents.set(spec.key, new Map());
    counters.set(spec.key, { cur: 0, other: 0, started: 0 });
  }

  // Day by day: a project starts on its own morning, its items follow over the next week, and work moves on in three passes.
  for (let day = 21; day >= LAST_DAY; day--) {
    clock.at(day, 9, 30);
    for (const spec of specs) {
      if (START_DAY[spec.key] === day) {
        builds.push(await setup(spec, actors, clock, today, counts));
        counts.projects += 1;
        counts.states += 5;
      }
      const b = builds.find((x) => x.spec === spec);
      if (!b) continue;
      for (const slot of (queue.get(spec.key) ?? []).filter((x) => x.day === day)) {
        await createItem(b, slot.it, day, b.made.length, counters.get(spec.key) as Counters, parents.get(spec.key) as Map<string, string>, actors, today, counts);
        clock.step(14);
      }
    }
    for (const pass of [0, 1, 2] as const) {
      clock.at(day, [14, 16, 17][pass] ?? 14, [30, 0, 20][pass] ?? 0);
      for (const b of builds) {
        for (const m of b.made) {
          for (const mv of m.moves.filter((x) => x.day === day && x.pass === pass)) {
            await run(ctxOf(actors, mv.who), "update_work_item", { work_item_id: m.id, state_id: need(b.states, mv.state) });
            clock.step(mv.who === "u" ? 9 : 20);
          }
        }
      }
    }
    if (day === 18) {
      clock.at(18, 19, 0);
      legacyId = await makeLegacy(actors, clock, today, counts);
    }
    if (day === 14) {
      // The completed cycles get their (past) dates; what they did not finish moves to the current cycle.
      clock.at(14, 19, 30);
      for (const b of builds) {
        for (const kind of ["done", "old"] as const) {
          const c = b.spec.cyc?.[kind];
          if (c?.[2] === undefined || c[3] === undefined) continue;
          await run(u, "update_cycle", { cycle_id: cycleOf(b, kind), start_date: addDays(today, c[2]), end_date: addDays(today, c[3]) });
          clock.step(20);
        }
        if (b.cycles.done && b.cycles.cur) await run(u, "transfer_cycle_work_items", { cycle_id: b.cycles.done, to_cycle_id: b.cycles.cur });
        clock.step(20);
      }
    }
  }

  // The end of the window: archives, relations and links on the hero items, views, board grouping and the archived project.
  clock.at(LAST_DAY, 18, 30);
  for (const b of builds) {
    for (const m of b.made.filter((x) => x.it.arch)) {
      await run(u, "archive_work_item", { work_item_id: m.id });
      counts.archived_items += 1;
      clock.step(10);
    }
    if (b.cycles.old) {
      await run(u, "archive_cycle", { cycle_id: b.cycles.old });
      counts.archived_cycles += 1;
    }
    const hardening = b.modules.get("Payments hardening");
    if (hardening) {
      await run(u, "archive_module", { module_id: hardening });
      counts.archived_modules += 1;
    }
    await makeViews(b, actors, counts);
    await run(u, "save_view_settings", { scope_type: "project", scope_id: b.id, display: { group_by: "state", order_by: "priority" } });
    clock.step(15);
  }
  const [mob, plat] = builds;
  const idOf = (b: Built | undefined, position: number): string => b?.made[position - 1]?.id ?? "";
  const relate = async (a: string, type: "blocked_by" | "relates_to", other: string) => {
    await run(u, "add_relation", { work_item_id: a, related_work_item_id: other, relation_type: type });
    counts.relations += 1;
    clock.step(6);
  };
  await relate(idOf(mob, 1), "blocked_by", idOf(mob, 6));
  await relate(idOf(plat, 4), "relates_to", idOf(mob, 1));
  const duplicateEmails = plat?.made.find((x) => x.it.n.startsWith("Customer reported duplicate"))?.id;
  if (duplicateEmails) await relate(duplicateEmails, "relates_to", idOf(plat, 4));
  for (const [title, url] of [["Idempotency dashboard", "https://metrics.orbit.example/d/idempotency"], ["Payments runbook", "https://docs.orbit.example/runbooks/payments"]] as const) {
    await run(actors.agents.coder, "add_link", { work_item_id: idOf(plat, 4), title, url });
    counts.links += 1;
    clock.step(6);
  }

  const agentIds = Object.values(actors.agents).map((a) => a.actor.id);
  await run(u, "create_view", { project_id: null, name: "Urgent and high across projects", description: "What needs attention first, in every project.", filters: { priority: ["urgent", "high"], state_group: ["unstarted", "started"] }, display: { layout: "table", order_by: "target_date" }, logo: { icon: "Fire", color: "orange" } });
  await run(u, "create_view", { project_id: null, name: "Work assigned to agents", description: "What the agents are carrying right now.", filters: { assignees: agentIds, state_group: ["unstarted", "started"] }, display: { layout: "table", order_by: "-updated_at" }, logo: { icon: "Lightning", color: "purple" } });
  counts.workspace_views += 2;
  const dsn = builds[2];
  if (dsn) await run(u, "update_project", { project_id: dsn.id, default_assignee_id: u.actor.id });
  clock.step(30);
  await run(u, "archive_project", { project_id: legacyId });
  return counts;
}

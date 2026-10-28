# Tessera performance report (round of 2026-10-28: lanes B and C integrated)

Status: integrated and verified in a scratch copy (AFTER = `6331186` plus lane B, decision 141, and lane C, decision 142), then corrected by a review-fix pass (section 9). Nothing is committed yet; the root planner merges. BEFORE = a fresh `6331186` copy (round 1 already in). Plan: `docs/drafts/perf-roadmap-2026-10-24.md` sections 5 to 8. Probes, raw results and medians: `docs/drafts/perf-2026-10-28/` (README there).

Every timing below is a median of interleaved production samples (BEFORE, AFTER, BEFORE, AFTER ...), each on a fresh `next start` and a fresh copy of the data set, with the 1-minute load average recorded. Load stayed low this time: 0.7 to 3.0 for production, 2.8 to 4.4 for the dev runs. Component counts and bytes do not depend on load. "10k" is the decision 115 fixture (10 000 items, the list shows 200 rows); "about 50 items" is the small fixture (48 rows).

---

## 1. In plain words

### What changed for you

- **Clicking inside a big list no longer freezes it.** Ticking a row checkbox on the 10k list took about 0.27 s with a quarter-second freeze; now it takes 0.09 s with no freeze at all. Changing a row's state from its selector went from 0.24 s to 0.06 s. Before, every click redrew all 200 rows (about 40 000 components); now it redraws about one row (1 500 components).
- **Agents writing in the background cost much less.** When an agent changes an item while you look at the list, the browser now redraws about 2 800 components instead of about 40 700, and uses half the CPU. The change still shows up within about 4 s (the change poller), and your own edits still show at once.
- **The peek opens faster.** On the 10k list the peek opens in 0.47 s instead of 0.70 s; on about 50 items in 0.19 s instead of 0.25 s. Closing it on the 10k list takes 0.21 s instead of 0.55 s.
- **List pages download about 30% less JavaScript.** The peek's editor (Tiptap, ProseMirror, highlighting, yjs) now loads in the background after the page is ready, instead of with the page. The work-items list's first download is 669 KB instead of 960 KB (compressed). The editor is preloaded when the browser is idle or the pointer touches a row. The first peek is faster overall. A peek clicked in the first second still waits for the editor download (about 40 to 50 ms on its own), but the cheaper list redraw more than pays for that.
- **Opening pages is a bit faster too.** The 10k list opens in 0.79 s instead of 0.93 s, the table in 1.40 s instead of 1.55 s, the sidebar click into the list in 0.84 s instead of 0.95 s. On about 50 items the list opens in 0.32 s instead of 0.35 s.
- **Two sidebar links now point at their real pages** (Your work, Analytics), so their skeleton appears sooner: 56 ms instead of 94 ms for Analytics.
- **Nothing visual changed.** The full browser suite (138 tests) passes.

### Before and after

Production, desktop 1440x900, CPU 1x unless marked. ms unless marked. n = samples per side.

| Moment | BEFORE | AFTER | Change | n | Load (1 min) |
|---|---|---|---|---|---|
| Tick a row checkbox, 10k | 265 (freeze 219) | **94** (no freeze) | −65% | 5+5 | 0.9–1.5 |
| Untick it, 10k | 221 (freeze 210) | **48** (no freeze) | −78% | 5+5 | 0.9–1.5 |
| Change a row's state from its selector, 10k | 237 (freeze 226) | **58** (no freeze) | −76% | 5+5 | 0.9–1.5 |
| Change a row's priority inline, 10k: row shows it | 411 | **366** | −11% | 5+5 | 0.8–1.8 |
| Same: list settled again | 600 (long tasks 294) | **318** (long tasks 74) | −47% | 5+5 | 0.8–1.8 |
| Open the peek, 10k | 697 | **472** | −32% | 5+5 | 1.6–3.0 |
| Close the peek, 10k | 548 | **209** | −62% | 5+5 | 0.9–1.5 |
| Agent write while the list is open, 10k: components redrawn | 40,720 | **2,787** | −93% | 5+5 | 0.7–1.9 |
| Same: browser CPU | 1,484 | **792** | −47% | 5+5 | 0.7–1.9 |
| Same: write to row shown (poller included) | 3,872 | **3,675** | −5% | 5+5 | 0.7–1.9 |
| Back to the list after another page, 10k | 1,063 (longest task 678) | **838** (429) | −21% | 5+5 | 0.7–1.9 |
| Open the list, 10k | 927 | **793** | −14% | 5+5 | 1.6–3.0 |
| Open the table, 10k | 1,552 | **1,403** | −10% | 5+5 | 1.6–3.0 |
| Open the board, 10k | 1,576 | **1,539** | −2% | 5+5 | 1.6–3.0 |
| Sidebar /inbox → list, 10k | 945 | **842** | −11% | 5+5 | 1.6–3.0 |
| Grouped list (250 rows) /inbox → list, 10k | 908 | 919 | +1% (no gain) | 5+5 | 0.9–1.5 |
| Open the list, about 50 items | 354 | **316** | −11% | 5+5 | 1.6–2.7 |
| Open the table, about 50 items | 522 | **481** | −8% | 5+5 | 1.6–2.7 |
| Open the peek, about 50 items | 250 | **186** | −26% | 5+5 | 1.6–2.7 |
| Sidebar /inbox → list, about 50 items | 569 | **530** | −7% | 5+5 | 1.6–2.7 |
| List, about 50 items, slow CPU (4x) | 1,404 | **1,148** | −18% | 5+5 | 0.9–1.8 |
| Table, about 50 items, slow CPU | 2,055 | **1,873** | −9% | 5+5 | 0.9–1.8 |
| /inbox → list, about 50 items, slow CPU | 926 | **782** | −16% | 5+5 | 0.9–1.8 |
| First-load JavaScript of the work-items list (gzip) | 960 KB | **669 KB** | −30% | build | — |
| Analytics skeleton after the sidebar click | 94 | **56** | −40% | 5+5 | 0.9–1.7 |
| First peek 2 s after load, about 50 items / 10k | 211 / 566 | **162 / 392** | −23% / −31% | 5+5 | 1.2–1.7 |
| **dev** sidebar /inbox → list, 10k | 1,827 | **1,505** | −18% | 5+5 | 2.8–4.2 |
| **dev** open the list, 10k | 2,194 | **2,078** | −5% | 5+5 | 2.8–4.2 |

"Freeze" is the longest long task (main thread blocked over 50 ms). "Open" is a hard load to the list's `[data-list-ready]` marker once it is hydrated. On about 50 items the server-rendered list sometimes paints before hydration, so those rows use the hydrated time.

### What is still slow, and why

The decision 115 budget (300 ms at p95 on 10k) is still missed. The perf spec (n=20, run twice per side) gives:

| | BEFORE p50 / p95 | AFTER p50 / p95 |
|---|---|---|
| list | 919 / 949, 918 / 972 | **877 / 902, 895 / 915** |
| table | 1,786 / 1,838, 1,823 / 1,889 | **1,594 / 1,653, 1,592 / 1,643** |
| board | 995 / 1,034, 263 / 1,045 | 262 / 1,049, 269 / 1,024 |

The board is bimodal on both sides (7 to 11 of 20 runs slow): it races the first paint of the server HTML against a roughly 1 s hydration task, so its p50 flips between runs. That is not a lane effect.

What fills the remaining time, from this round's profile (prod, 10k list, CPU 1x, before this integration):

1. **Closed popovers mounted per row (about 8.5 per row).** 1,709 closed popovers make up 63% of the 53,000 DOM elements: 590 listboxes with 3,523 options, 704 tooltips and 400 date dialogs. Astryx Selector renders every option of a closed listbox. This is the largest lever left: lazy listbox content or windowing.
2. **A forced style recalculation per layer (Astryx `useLayer`).** Every Tooltip, Popover and Selector reads `getComputedStyle` twice in a ref callback (`readPortalWritingContext`), then mounts a second render pass of about 33,000 components. Stubbing those reads saved 133 ms (−15%) on the 10k list, 259 ms (−18%) on the 10k table and 1.3 s (−34%) on the 10k list at CPU 4x, but only 11 ms on about 50 items. This is an upstream Astryx fix: Tooltip and Popover do not pass `lazyMount`, which HoverCard does.
3. **Hydration blocks the first paint** of the list and table at 10k (their server HTML is 3.3 MB, about 16.6 KB per row), so "ready" equals the end of hydration.
4. **React's 300 ms Suspense fallback throttle** on every first visit of a route in a session: the main thread sits idle for about 250 ms after the code is in (`FALLBACK_THROTTLE_MS = 300` in react-dom). Cutting it took the small list navigation from 560 to 283 ms and the Analytics first visit from 474 to 179 ms; at CPU 4x it changed nothing. Revisits skip it.
5. **Each peek open, switch or close refetches nearly the whole list's RSC payload** (225 to 232 KB at 10k, 62 to 70 KB at about 50 items).
6. **Small leftovers:** `useTruncation` from the project frame title Heading and one Text (up to 64 ms at 1x, about 300 ms at 4x, upper bound).
7. **Not the app code:** Tessera's own components are 1.4% of busy time at 10k. Astryx is 31%, react-dom 18%. More app-side memoization has a small ceiling now.

### What this means for P12's thresholds

Corrected in the review (section 9). The first version of this paragraph extrapolated from a two-point fit (48 rows on the small fixture, 200 rows on the 10k one), taken on different harnesses. This version is a sweep on one database with the budget's own harness: the decision 115 spec (`tests/e2e/perf.spec.ts`, warm cache, hard navigation, p95 of n = 20 after 2 warm-up rounds, CPU 1x, production build of AFTER, 10k fixture), changing only the page size (rows per state group for the grouped spec, the ungrouped page for the flat list). Load stayed at 1.6 to 3.1.

| Rows drawn | List p95 (grouped) | Table p95 (grouped) | List p95 (ungrouped) | Table p95 (ungrouped) |
|---|---|---|---|---|
| 25 | 198 | 257 | 191 | 255 |
| 50 | 274 | 395 | 264 | 380 |
| 100 | 428 | 674 | 422 | 648 |
| 200 | 764 | 1,304 | 754 | 1,265 |
| 250 (the spec as it is) | 951 | 1,643 | — | — |

Straight-line fit on that one database (r² 0.998 to 1.000): the list costs about **105 ms + 3.3 ms per row**, the table about **85 to 95 ms + 5.8 to 6.2 ms per row**. A 300 ms p95 therefore holds about **58 to 60 list rows and about 34 to 35 table rows** at CPU 1x with a warm cache. 50 rows fit for the list (264 to 274 ms) and miss for the table (380 to 395 ms); 25 rows fit for both. The earlier "about 60 and 30" was close to this by luck, and its stated basis was wrong.

Three things to keep in mind when reading these numbers:

- The small-fixture figures in section 4.1 (list 316 ms, table 481 ms for 48 rows; list 1,148 ms at CPU 4x) are a different measurement: a cold page, time to hydrated, niced probes. They do not follow the budget's definition, and they show that 48 rows miss 300 ms there. The 10k spec, which is the budget, has 50 rows at 264 to 274 ms.
- The spec's own list (grouped by state, 5 x 50 = 250 rows) reads about 110 ms higher than section 4.1's 10k list (ungrouped, 200 rows, median 793 ms). The sweep explains it: 50 more rows at 3.3 ms per row, plus p95 against a median. At 200 rows the two harnesses agree (754 to 764 ms p95).
- CPU 4x was not run with the spec. The only 4x figure is the small fixture's (cold, 48 rows, 1,148 ms hydrated), which says no number of rows near 48 fits at 4x; a 4x fit would need the spec with throttling, which was not done. Likewise not re-measured with the Astryx `useLayer` fix (the profile's stub saved 133 ms on the list at 200 rows, about 0.7 ms per row, so it would add roughly 15 to 20 rows to the list's allowance; that is an estimate from the profile, not a sweep).

For P12: windowing the list to about 50 rows (including overscan) is enough for the budget at 1x. Windowing alone probably cannot reach it for the table: the table has a fixed 85 to 95 ms and 6 ms per row, so a window of 34 rows including overscan is the limit, and a window that small leaves little room for overscan around what a viewport shows. The table needs a smaller per-row cost (point 1 above) as well as windowing. Decision 135 windows above 250 rows, so the default 200-row page keeps missing the budget (list 754 ms, table 1,265 ms p95) until P12 windows much earlier or the per-row cost drops.

---

## 2. Gate on AFTER

| Step | Result |
|---|---|
| Merge | The lanes touched disjoint files (21 for lane B, 15 for lane C, 36 in total); `diff -rq` against a fresh BASE copy shows exactly these 36, and `cmp` confirms every AFTER file equals its lane copy. No three-way merge was needed. One later change: `scripts/bundle-baseline.json` was rewritten from AFTER's build (below). |
| `npm run check` (typecheck, eslint with react-hooks 7, Vitest, conventions, licences, theme + astryx doctor) | exit 0, at nice 0: 254 test files, 3,119 tests. astryx doctor shows only the documented `theme-fonts` warning. No new eslint-disables. |
| `next build` | exit 0 |
| `npm run check:bundle` | exit 0 (forbidden-string scan clean on 135 files; 53 routes within 5% of the baseline) |
| Full e2e, `E2E_PORT=3830 npx playwright test` | **138 passed, 1 skipped** (the perf spec skips itself outside its config), 10.0 min, no failures, no flakes, no re-runs needed |
| Decision 115 perf spec, `PERF_PORT=3831`, LARGE, n=20, AFTER and BEFORE, twice each in reversed order | exits 1 on both sides: the 300 ms budget is missed by design (section 1). Load 2.2 to 3.5. |

**Bundle baseline.** Lane C wrote `scripts/bundle-baseline.json` from lane C's own build. Against it, AFTER's first-load sizes were **+0.1% on 52 of 53 routes** (+0.6 KB gz each, for example `/` 589.6 → 590.2 KB, work-items 668.6 → 669.3 KB) and unchanged on `/_not-found`. The only chunk that differs in content is a shared app-shell chunk (24,316 → 26,044 bytes raw, +605 bytes gz). Its new strings are lane B's `project-provider.tsx`: the lean `ProjectRowContext` (`useProjectRow`, its error message, and the stripped field names `counts`, `last_seen_at`, `links_count`, `member_ids`, `next_sequence`, `open_count`, `progress`, `updated_at`, `updated_by`). ProjectProvider is on every route, so every route grows by the same bytes. The difference is fully explained by lane B, so I rewrote the baseline from AFTER's build with `npx tsx scripts/check-bundle.ts --update-baseline` and re-ran `check:bundle` (passes) and `tests/check-bundle-budget.test.ts` (16 passed). The lane C baseline is kept in `docs/drafts/perf-2026-10-28/baseline/integ/bundle-baseline.lane-c-build.json`.

---

## 3. Metrics to beat (roadmap section 5)

### Lane B (decision 141)

| Metric | Target | BEFORE | AFTER | Met |
|---|---|---|---|---|
| dev, 48 rows: components on select | ≤ 1,500 | 9,227 | **1,220** | yes |
| dev, 48 rows: WorkItemRow renders per tick | ≤ 1 | 48 | **≤ 2** (not among the 60 most-rendered types, whose cut-off is 2; the Vitest `list-row-memo` asserts exactly 1) | yes |
| dev: state pick | ≤ 4,500 | 19,655 | **3,661** | yes |
| dev: peek open | ≤ 5,500 | 12,276 | **4,458** | yes |
| dev: peek close | ≤ 6,500 | 21,184 | **4,838** | yes |
| dev: agent-write refresh (steady state) | ≤ 3,500 | 10,735 | **2,723** | yes |
| prod 10k: tick task | ≤ 200 ms | 320 ms (trace RunTask 333, script 191) | **117 ms** (RunTask 170, script 18), no long task | yes |
| prod 10k: agent-write refresh | ≤ 6k components | 40,720 | **2,787** | yes |
| prod 10k: longest task on navigating back to the list | ≤ 1.5 s | 678 ms | **429 ms** | yes |
| Grouped 10k list draw | ≥ 6% faster | 908 ms | 919 ms (+1%) | **no** (the `:has()` rule costs a grouped list nothing; the gain is on the ungrouped list and the table, section 9) |
| List and table ready | within +3% of base | 927 / 1,552 | 793 / 1,403 | yes (−14% / −10%) |

The dev counts are n=1 per side (deterministic), on cold `next dev` servers over fresh SMALL copies. The first agent write after a page load rendered about 10k components in dev (38k at 10k in prod) on both sides, but that was a probe artifact, not a one-off post-hydration commit: the probes write with `--client react-probe`, an actor neither fixture has, so the first write registers `mcp:react-probe`, the project's actor list changes, the row bundle changes, and every row correctly redraws its assignee options. A write by an actor the app already knows costs the steady-state number from the first write on (section 9 has the check). The grouped target stays missed (+1%): a grouped list matches `:has(.tessera-wi-group)` at its first group, so the old rule costs it nothing. The class swap pays on the default, ungrouped list and on the table, where `:has()` scans the whole scroller subtree and never matches: putting the old rule back on the same build costs +95 ms (section 9). The class swap stays for that reason, not for the grouped list.

### Lane C (decision 142)

| Metric | Target | BEFORE | AFTER | Met |
|---|---|---|---|---|
| First-load gz, work-items | ≤ 560 KB | 960.1 | **669.3** | **no** (−30%) |
| cycles/[cycleId] | ≤ 690 | 1,081.4 | **793.3** | **no** (−27%) |
| views/[viewId] | ≤ 565 | 962.6 | **671.9** | **no** (−30%) |
| modules/[moduleId] | ≤ 580 | 973.1 | **684.4** | **no** (−30%) |
| archives/work-items | ≤ 565 | 961.8 | **673.3** | **no** (−30%) |
| No route grows more than 1% | ≤ +1% | — | worst +0.2% (`/your-work/[tab]`, `/agents/[actorId]/[tab]`) | yes |
| wi-list script, CPU 4x, 375 px, about 50 items | ≤ base − 150 ms | 991.5 | **844** (−147.5) | **no, by 2.5 ms** (within noise; the lane measured −164) |
| Same at CPU 1x (report; expected −40 to −60) | — | 217.5 | 170 (−47.5) | as expected |
| Peek after idle: scripts after pointerdown | 0 extra | 1 (1 KB) | 1 (the same 1 KB chunk) | yes |
| Peek after idle: click to editor | ≤ base + 20 ms | 211 (small), 566 (10k) | **162, 392** | yes (faster) |
| Peek 300 ms after load (report) | — | 210 (small), 588 (10k) | 162, 414 (10k fetches 328 KB of scripts after the press) | reported |
| Analytics skeleton with a prefetched shell | ≤ 50 ms | 94 | **56** | **no, by 6 ms** |
| No post-hydration commit containing DateControl | none | a 1,805-component commit with DateControl=96 | **none** | yes |
| dev LOAD components | ≤ base − 1,000 | 16,708 | **15,556** (−1,152) | yes |

The five first-load targets came from the roadmap's prediction (553 KB for work-items), which neither lane C nor this run could reproduce: the editor chunks are fully out, and what is left is shared app, React and Astryx code. The early-click peek case was slower in the lane alone (+40 to +53 ms); integrated with lane B it is faster than BEFORE on both sets (lane B's cheaper list re-render more than pays for the chunk wait).

### Freshness (decisions 12 and 127)

- No `'use cache'`, `cacheTag` or other data cache was added by either lane (the cache lane stays dropped).
- Agent write while the list is visible: the row showed the new title in 3.68 s (AFTER) vs 3.87 s (BEFORE), within the about 5 s poller budget, on every one of the 10 samples.
- Agent write while the list is hidden under Activity, then navigating back: the list showed the new title in all 10 samples (`back.stale = false` on both sides).
- The user's own inline priority edit showed in the row in 366 ms (411 BEFORE), with the server action at 205 to 321 ms.
- `shareStructure` always returns a value deep-equal to the new server data (it only reuses identities of equal subtrees), so memoized rows cannot keep stale data; `tests/ui/stable.test.ts` and `list-row-memo.test.ts` cover a changed leaf and a changed row.

---

## 4. This run in detail

Raw lines are in `docs/drafts/perf-2026-10-28/baseline/integ/*.jsonl`; medians for all of them in `medians.json`.

### 4.1 Hard loads and navigation (`integ-sample.mjs`; hydrated time)

| Scenario | BEFORE | AFTER | Change |
|---|---|---|---|
| 10k list ready / longest task / total long tasks | 927 / 615 / 754 | 793 / 478 / 559 | −14% / −22% / −26% |
| 10k peek open / long tasks | 697 / 372 | 472 / 291 | −32% / −22% |
| 10k table ready / longest task | 1,552 / 1,241 | 1,403 / 1,092 | −10% / −12% |
| 10k board ready | 1,576 | 1,539 | −2% |
| 10k sidebar /inbox → list | 945 | 842 | −11% |
| 10k DOM elements, list / table / board | 53,065 / 56,030 / 13,057 | +1 each | 0% |
| Small list / table / board (hydrated) | 354 / 522 / 348 | 316 / 481 / 316 | −11% / −8% / −9% |
| Small peek | 250 | 186 | −26% |
| Small sidebar /inbox → list | 569 | 530 | −7% |
| Small, CPU 4x: list / table / board (hydrated) | 1,404 / 2,055 / 1,264 | 1,148 / 1,873 / 1,125 | −18% / −9% / −11% |
| Small, CPU 4x: peek / nav | 778 / 926 | 588 / 782 | −24% / −16% |

The URL-commit time of the 10k navigation is bimodal on both sides (70 to 75 ms or 93 to 100 ms), so its +18 ms median is noise.

### 4.2 Interactions on the 10k list (`inter-sample.mjs`, `select-sample.mjs`, `prio-sample.mjs`)

| Interaction | BEFORE ms / components / longest task | AFTER |
|---|---|---|
| Tick checkbox | 265 / 39,465 / 219 | 94 / 1,493 / 0 |
| Untick | 221 / 38,776 / 210 | 48 / 804 / 0 |
| Peek open | 770 / 42,547 / 366 | 499 / 4,824 / 276 |
| Peek close | 548 / 81,393 / 208 | 209 / 5,151 / 78 |
| Open a row's state selector | 70 / 88 / 0 | 68 / 88 / 0 |
| Pick a state | 237 / 79,542 / 226 | 58 / 3,662 / 0 |
| Select trace (RunTask / script) | 333 / 191 | 170 / 18 |
| Deselect, select again, select a second row (dt) | 255, 249, 222 | 62, 72, 56 |
| Priority edit: open / row shows it / settled / long tasks | 126 / 411 / 600 / 294 | 121 / 366 / 318 / 74 |

### 4.3 Agent writes and navigation back (`refresh-sample.mjs`, 10k)

| Step | BEFORE components / CPU ms / longest task | AFTER |
|---|---|---|
| First write after load, by an actor the app has not seen (probe artifact, see section 9) | 40,723 / 790 / 74 | 37,937 / 752 / 63 |
| Write, list visible (steady) | 40,720 / 1,484 / 59 | 2,787 / 792 / 0 |
| Navigate away to Inbox | 40,933 / 641 / 0 | 2,807 / 569 / 0 |
| Write while the list is hidden | 40,839 / 1,303 / 0 | 2,711 / 599 / 0 |
| Navigate back to the list (ms) | 1,063 ms, 72,740 / 1,637 / 678 | 838 ms, 34,807 / 1,411 / 429 |

The navigation back still renders about 34,800 components with only one WorkItemRow among them: Astryx Selector, Button and Popover re-render with unchanged props on Activity reveal (lane B's finding), which this round does not address.

### 4.4 Assets per route (`ab-assets.mjs`, 375x812 mobile, cold cache, n=8)

| Route | CPU | Script ms BEFORE → AFTER | Long tasks | Row visible | JS fetched |
|---|---|---|---|---|---|
| wi-list (small) | 4x | 991.5 → 844 | 1,150 → 1,139 | 146.5 → 148.5 | 982 → 993 KB |
| wi-peek deep link (small) | 4x | 1,259.5 → 1,091.5 | 1,804 → 1,734 | 150 → 152.5 | 984 → 995 KB |
| cycle (small) | 4x | 721.5 → 584 | 735.5 → 724.5 | 129.5 → 129.5 | 1,105 → 1,115 KB |
| wi-list (small) | 1x | 217.5 → 170 | 224.5 → 188.5 | 100.5 → 101 | |
| wi-peek (small) | 1x | 290.5 → 268.5 | 377 → 354 | 102 → 100 | |
| cycle (small) | 1x | 175 → 140.5 | 149.5 → 119.5 | 73 → 61 | |
| wi-list (10k) | 1x | 474 → 412 | 815.5 → 695 | 181.5 → 178.5 | |

AFTER fetches about 10 KB more JavaScript in total: the idle preload downloads the editor chunk inside the 3.5 s settle window, off the critical path.

### 4.5 First peek (`ab-peek.mjs`, 1440, no throttle, n=5)

| Click | Set | BEFORE ms / scripts after press | AFTER |
|---|---|---|---|
| 2 s after load | small | 211 / 1 (1 KB) | 162 / 1 (1 KB) |
| 2 s after load | 10k | 566 / 1 (1 KB) | 392 / 1 (1 KB) |
| 300 ms after load | small | 210 / 5 (12 KB) | 162 / 3 (10 KB) |
| 300 ms after load | 10k | 588 / 7 (25 KB) | 414 / 11 (328 KB) |

### 4.6 Sidebar prefetch (`prefetch-probe.mjs`, small, n=5 per side)

Click nav Analytics from /inbox: skeleton 94 ms (80 to 95) → 56 ms (55 to 58); ready 450 → 399 ms. BEFORE's link is `/analytics` (redirect), AFTER's `/analytics/overview`. Click nav project Work items from Analytics: skeleton 41 → 40, ready 479 → 470.

### 4.7 Dev (`ab-dev.sh` with `code-wi-sample.mjs`, 10k, cold `next dev` per side, n=5)

| | BEFORE | AFTER | Change |
|---|---|---|---|
| Open the list (hydrated) | 2,195 | 2,079 | −5% |
| Longest task / total long tasks | 1,608 / 1,919 | 1,511 / 1,664 | −6% / −13% |
| Sidebar /inbox → list | 1,827 | 1,505 | −18% |

### 4.8 Dev component counts, about 50 items (`dev-counts.sh`: `devcount.mjs`, `loadcommits.mjs`, `refresh-dev.mjs`, n=1 per side)

| Scenario | BEFORE | AFTER |
|---|---|---|
| LOAD | 16,708 (28 commits) | 15,556 (31 commits) |
| Post-hydration commit with DateControl | 1,805 components, DateControl=96 | none |
| select / deselect | 9,227 / 8,866 | 1,220 / 867 |
| peek open / close | 12,276 / 21,184 | 4,458 / 4,838 |
| state pick | 19,655 | 3,661 |
| agent write: first / steady | 10,749 / 10,735 | 10,091 / 2,723 |

### 4.9 First-load JavaScript per route (gzip, from `.next/diagnostics/route-bundle-stats.json`)

The five list routes drop 27 to 30% (table in section 3). Every other route is within −0.0% to +0.2% (`baseline/integ/bundle-before-after.json`).

---

## 5. Not done

- **Grouped list ≥ 6% faster (lane B):** not met (+1%), and it cannot be met by this change: a grouped scroller matches `:has(.tessera-wi-group)` at its first group. The class replacement does pay on the ungrouped list and the table (about −95 ms, section 9).
- **First-load byte targets (lane C):** not met for all five list routes (669 to 793 KB against 560 to 690); the roadmap's 553 KB could not be reproduced.
- **wi-list script at CPU 4x ≤ base − 150 ms:** −147.5 ms here (−164 in the lane); treat it as met within noise, but it is not met on this run's median.
- **Analytics skeleton ≤ 50 ms:** 56 ms (from 94).
- **Navigation back to the list** still renders about 34,800 components (Astryx internals on Activity reveal); its longest task, 429 ms, is within the 1.5 s target.
- **Table, board, calendar and gantt rows are not memoized** (only the list's WorkItemRow); known debt in `docs/as-built/work-items.md` and the roadmap's do-next #13 and with-P12 items.
- **`RowProject` is rebuilt on every row render** in RowProperties (known debt, as-built doc).
- The decision 115 spec still fails its 300 ms budget (section 1).
- Not measured in this run: the table and board fan-out at CPU 4x on 10k, peek-animation frame times (with-P12), and filter-bar typing (M11).

## 6. Next levers (from the profile, ranked)

| # | Lever | Expected effect | Owner |
|---|---|---|---|
| 1 | Lazy listbox / popover content per row, and windowing far earlier than 250 rows (about 50 list rows; the table needs a window of at most 34 rows and a lower per-row cost, see the P12 paragraph in section 1) | the largest one: most of the 33,600 closed-popover elements at 200 rows. Per-row cost today: list 3.3 ms, table 6 ms (sweep, section 1). Windowing to 50 list rows gives 264 to 274 ms p95; the lazy content alone is not measured and was estimated at −200 to −400 ms at 200 rows | P12 windowing |
| 2 | Astryx `useLayer`: no `getComputedStyle` and no second mount pass for closed layers (`lazyMount` for Tooltip and Popover) | −130 ms 10k list, −260 ms 10k table at 1x; −1.3 s 10k list at 4x | Astryx upstream |
| 3 | Avoid the 300 ms Suspense fallback hold on first visits | −230 to −300 ms per first visit at 1x | new |
| 4 | Peek without refetching the whole list RSC | −85% of 225 to 232 KB per peek push at 10k | new (roadmap "peek-without-list-rerender") |
| 5 | Board: yield before hydration so the server HTML paints | slow tail 1.0 to 1.3 s → about 0.25 s | new |
| 6 | Replace the last `maxLines` Heading/Text in ProjectFrame with CSS one-line text | up to −64 ms at 1x | new |

## 7. Needs you

Nothing in this round needs a download, an approval or a public post. After the root merges this round, the reconciler runs `npm run live:update` once (decision 140) and announces it.

## 8. How this was measured

- Copies: BEFORE = `bc/before`, AFTER = `bc/after` (scratchpad), both from `git archive 6331186`, `node_modules` cloned, `next typegen`, `next build` with `TESSERA_DB_PATH=data/build/build.db`.
- Data: copies of the scratchpad's `p11-perf.db` (10k) and `small.db`, migrated once (0 migrations pending), then a fresh copy per sample (per probe for the dev counts, which write).
- Production: `next start -H 127.0.0.1` with automations and webhooks off and no `ANTHROPIC_API_KEY`; BEFORE on 3834 (10k) / 3835 (small), AFTER on 3832 / 3833; e2e on 3830, perf spec on 3831. Ports 3000 and 3001, `data/tessera.db` and `data/dev/` were never touched.
- The campaign ran as one chain (`scripts/integ/chain.sh`). zsh lowers the priority of background jobs (`bg_nice`), so the probes and servers ran niced; both sides equally, on an otherwise quiet machine (load 0.7 to 3.0).
- Next docs relied on: `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (`next/dynamic` at module top level for preloading, "Good to know" under `next/dynamic`), `02-guides/prefetching.md:64` (automatic prefetching only in production), `01-getting-started/04-linking-and-navigating.md:107` (dynamic routes are partially prefetched: shared layouts and loading skeletons).
- The "what is still slow" section comes from this round's profile run (results under `baseline/profile/`, scripts under `scripts/profile/`); its numbers were taken on BEFORE-equivalent code and are not re-measured on AFTER, except where section 4 says so.

## 9. Review fixes

A review of the integrated change set found one medium and six low issues. All were handled; one was answered with a measurement that contradicts the reviewer's premise, so the code stays as it was. Raw results, scripts and the sweep patch: `docs/drafts/perf-2026-10-28/review-fixes/`.

| Finding | What was done | Evidence |
|---|---|---|
| P12 thresholds (medium) | Re-derived with the decision 115 harness on the 10k fixture, only the page size varied (9 points, n = 20 each). Section 1 and the section 6 lever now carry the result: list about 58 to 60 rows, table about 34 to 35 rows at 1x. | `review-fixes/fixer-sweep.jsonl`, `scripts/sweep.sh`, `sum-sweep.mjs`, `sweep-copy.patch` |
| `shareStructure` / `useShared` (NaN, key missing in `prev`) | Values compare with `Object.is` (also in `shareArray` and `useShared`); a key `prev` lacks always makes a copy. Three tests added to `tests/ui/stable.test.ts` (NaN keeps identity, `{a: undefined}` vs `{b: undefined}` keys, `useShared` settles on a NaN). | Vitest 254 files, 3,122 tests |
| `check-bundle.ts` guard | The entry test compares `fs.realpathSync(process.argv[1])` with `realpathSync(fileURLToPath(import.meta.url))`. Through a symlinked checkout the pre-fix script printed nothing and exited 0; the fixed one runs the gate (`First-load budget passed: 53 routes`). | run from a symlinked folder, both trees |
| Stale comment, chords | `properties/index.ts` says `useProjectRow()`. `nav.yourWork` and `nav.analytics` push `/your-work/summary` and `/analytics/overview`, like the sidebar and Power K. | `useShortcuts.ts` diff |
| "One-off post-hydration commit" (lines 119 and 192) | Rewritten: a probe artifact. See the first-write table below. | `fixer-first-write-*.jsonl` |
| Plain-words peek claim | Reworded (section 1): faster overall, an early click still waits for the editor download. | — |
| Grouped-list `:has()` class | **Kept.** Measured, and the result contradicts the premise: see below. | `fixer-has-*.json*`, `fixer-ab-integ-*.jsonl` |

### The scroller class (`tessera-wi-scroller--grouped`)

The reviewer asked for a tick and an agent write on a grouped 10k list to be measured, and for the change to be reverted if there is no gain. Measured on one production build (`has-recalc.mjs`, grouped 10k list, the class rule retargeted to `.tessera-wi-scroller:has(.tessera-wi-group)` through the CSSOM, the two modes alternating, n = 6 each, load 1.3):

| Scenario (CDP Performance.getMetrics over the window) | `:has()` | class |
|---|---|---|
| 80 DOM insert / remove in a row: style recalc | 7.2 ms | 6.9 ms |
| Collapse and expand a group: style recalc | 31.7 ms | 31.2 ms |
| One agent write refreshing the list: style recalc | 0.5 ms | 0.5 ms |

So the reviewer is right for a grouped list and for later DOM changes: no gain. The first reply was therefore to revert (a revert was built and gated: check, build and bundle all passed). The revert then failed the A/B on the **ungrouped** 10k list, which was never measured before: an interleaved A/B (fresh server and database copy per sample, n = 5 + 5, load 1.5 to 6.4) gave list ready **786 to 881 ms (+12%)**, table ready 1,379 to 1,508 ms (+9%), sidebar navigation 837 to 934 ms (+12%), board unchanged. A controlled check on one build (the class rule retargeted to `:has()` before the /inbox to list click, n = 6 + 6) confirmed it: **826 ms with the class, 920 ms with `:has()`** (long tasks 424 against 518 ms). The reason is the shape of the selector. On a grouped list `:has(.tessera-wi-group)` matches at the first group; on a flat list it never matches, so every style invalidation walks the whole scroller subtree of about 50 000 elements. The default list and the table are flat.

The revert was undone: `list-groups.ts`, the scroller class, the CSS rules, `wi-scroller-css.test.ts` and the `list-row-memo` test are back as in the integrated set. The class is not a gain for the grouped list (+0.2% in a second A/B, n = 5 + 5: 927 against 929 ms), and the report no longer calls it "correct and safe": it is worth about 95 ms on the flat list and the table. `docs/as-built/work-items.md` says so, so nobody reverts it on a grouped probe.

### The first write after a load

The probes write with `--client react-probe`; on a fixture without an `mcp:react-probe` actor that first write adds an actor, the project's actor list changes and every row correctly redraws its assignee options. Writing as a client the app already knows costs the steady-state number from the first write on (production, 10k, n = 3 and n = 4, fresh server per sample):

| First write after a hard load | Components | CPU ms | Longest task |
|---|---|---|---|
| By a client the app has not seen (`mcp:react-probe` or `mcp:perf-agent-1`; the fixture's `perf-agent-1` is a differently named actor) | 37,937 | 778 to 850 | long tasks 62 to 66 ms |
| By a client registered before the page loaded (one write before the load) | **2,790** | 459 to 535 | 0 |
| The write after that | 2,787 | 773 to 1,183 (both cases) | 0 |

Section 4.3's "first write" row is the first of these; its steady state is the real figure for agents that already work in the project.

### Gate after the fixes

| Step | Result |
|---|---|
| `npm run check` | exit 0: 254 files, 3,122 tests (3,119 before, three added); astryx doctor shows only the documented `theme-fonts` warning |
| `next build` | exit 0 |
| `npm run check:bundle` | exit 0: 53 routes within 5% of the baseline (unchanged, +0.0%) |
| Affected e2e (round6, workspace, work-items, layouts, external-writes) | 43 passed |
| Full e2e, `E2E_PORT=3830` | **138 passed, 1 skipped**, 9.9 min, no failures, no flakes |
| Interleaved A/B, pre-fix tree against fixed tree, production, 10k, n = 5 + 5 (load 1.8 to 8.3, the first pair ran right after the build) | list ready 802 / 811 (+1.1%), table 1,417 / 1,404 (−0.9%), board 1,549 / 1,545 (−0.3%), sidebar navigation 850 / 851, list longest task 489 / 483: no change, the gains are kept |

Ports used: 3838 and 3839 for the A/B and the sweep, 3830 for the e2e suite. The sweep used a scratch copy (`after-sweep`) whose only differences are two environment variables read by `paging.ts` and two variables read by `perf.spec.ts` (`sweep-copy.patch`); the shipped files are untouched. Measurement caveat as in section 8: zsh runs background jobs niced, equally for both sides. Nothing under 3000, 3001, `data/tessera.db` or `data/dev/` was touched.

# Tessera performance roadmap (2026-10-24)

Status: decided (the user delegated the decisions: "you decide"). Baseline: git `d26461b`. Copy this file to `docs/drafts/perf-roadmap-2026-10-24.md`: the /tmp scratchpad gets wiped (field guide).

Short paths used below:
- `PERF` = `/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf` (the perf-run: measurements and quick wins)
- `PR` = `/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf-research` (five research lanes and two skeptics)
- `R` = `PR/react`

Every wall-clock number comes from a shared machine (load 2.5 to 56 across the runs) and is only indicative. Component counts, bytes and DOM nodes do not depend on load, so they are the stronger evidence. I took no new timings for this roadmap (load 3.0 to 3.8 while I wrote it). The perf-run report `PERF/perf-report-2026-10-24.md` did not exist yet at 02:53. This roadmap therefore assumes that perf-run lands the two quick wins it measured (see "Assumptions").

---

## 1. In plain words

### What makes Tessera feel slow today, in order

1. **You run the development server.** `next dev` (package.json `dev`, `.claude/launch.json` port 3000) leaves out most of what makes Next fast:
   - It never prefetches. Automatic prefetching runs only in production (`node_modules/next/dist/docs/01-app/02-guides/prefetching.md:64`).
   - It compiles every page the first time you open it: 0.4 to 7.6 s per page.
   - It renders everything twice (Strict Mode) and runs extra checks in the background.
   - A warm sidebar click in dev takes 1.3 to 3.6 s with no skeleton. Under `next start` the skeleton appears in 33 to 106 ms, and a page you already visited is ready in 34 to 121 ms.
   - Hard loads are 2 to 3 times faster in production: Home 589 vs 202 ms, work-item list 2164 vs 889 ms, work item 797 vs 309 ms.
2. **The work-item list and table are slow to draw in the browser.** The server answers in 10 to 25 ms. The time goes into building rows on the client.
   - On the 48-row project, opening the list takes 627 to 880 ms and the table about 1.5 s.
   - On the 10 000-item test project, the list takes 7.1 s and the table 16.5 s.
   - The perf-run's two quick wins halve this: list 859 → 412 ms, table 1562 → 813 ms, 10k list 7.1 → 1.1 s.
3. **Every click inside the list redraws the whole list.** Ticking one checkbox, changing a state or opening the peek re-renders every row.
   - On a 200-row page that is about 67 000 components and a 0.8 to 0.95 s freeze per checkbox.
   - Every write from an agent re-renders about 69 000 components in the background. Tessera is AI-first, so agents write while you work.
4. **List pages ship the editor up front.** The peek's editor (Tiptap, ProseMirror, lowlight, yjs) is in the first download of 12 routes. That is about 400 KB gzipped of extra JavaScript to parse on every hard load of a list page.
5. **Small things.**
   - Two sidebar links (Your work, Analytics) point at pages that redirect, so their skeleton cannot be prefetched.
   - Every date control in every row renders a second time right after the page loads, for no reason.
   - On a grouped 10k list, one CSS rule (`:has()` on the scroller) costs about 9% of the list's draw time.

What is **not** slow: SQLite takes 1 to 5 ms per page at your likely data size. Production server responses take 2 to 4 ms to first byte and 12 to 42 ms for a navigation.

### What we will do

- **Lane A: run Tessera as a "live app".** Your daily app becomes a production build of the last commit, served on the same address, http://127.0.0.1:3000.
  - `npm run live` starts it. `npm run live:update` rebuilds it after each merge in about 25 to 30 s and swaps it in under 1 s. `npm run live:rollback` goes back one release.
  - The dev server moves to port 3001 with its own database, for anyone who wants to see uncommitted work.
  - Agents get clear rules about who may touch your live server.
- **Lane B: redraw only what changed.** Rows are memoized, and each row gets its own props instead of the whole selection. Data from the server keeps its identity when it has not changed. Row controls read a slim project context that does not change on every write. The one costly `:has()` rule becomes a class.
- **Lane C: load less up front.**
  - The peek's editor loads on demand. It preloads when the browser is idle or the pointer first touches a row, so the first peek does not wait for it.
  - A byte budget per route keeps it that way.
  - The two sidebar links point at their final pages, and the week-start store stops the extra re-render after load.

### What it should feel like afterwards

| Moment | Today (dev) | After lane A (prod, HEAD) | After perf-run plus lanes B and C | Source |
|---|---|---|---|---|
| Sidebar click, page seen before | 1.3 to 3.6 s, no skeleton | 34 to 121 ms, skeleton at 33 to 106 ms | same | PR/next dev-nav-*.json; PERF/results/nav-small-none.json; nav-ab-small-none.json |
| Sidebar click, first visit in a session | 0.4 to 7.6 s (compile) | 215 to 460 ms | same, maybe less (open measurement M3) | PERF/results/nav-ab-small-none.json |
| Hard load Home | 589 ms | 202 ms | about 200 ms | PR/runtime/results/browser-*-small*.json |
| Hard load of a work item | 797 ms | 309 ms | about 300 ms | same |
| Open the work-item list (48 rows) | 2.2 s hard load | 627 to 880 ms click to ready | about 410 ms (perf-run measured), a few % less with lane C's smaller first load | PERF/results/code-ab-prod-small-medians.json |
| Open the table (48 rows) | 3.5 s hard load | about 1.5 s | about 810 ms (perf-run measured) | same |
| Tick a row checkbox (200 rows) | worse than prod | 0.83 to 0.95 s | about 0.1 s plus 26 to 100 ms of style on the first tick (projected) | PR/skeptic2/probe/select-trace-1.json; R/out-dev-small-*.json |
| Agent writes while you look at the list | 17.8k to 69k components re-rendered | same | about 3.3k components, about −95% (background work) | R/out-refresh-dev-final.json |
| 10k-item list | 13+ s | 7.1 s | about 1.0 to 1.1 s; still above the decision 115 budget of 300 ms (see section 7) | PERF/results/code-ab-prod-large-medians.json |

"Projected" means derived from deterministic component counts plus one production trace, not measured end to end. Lane B's verify step measures it.

### What changes for you

- Port 3000 shows only **committed** work. After each merged batch the reconciler runs `npm run live:update` and tells you in chat. Your open tab reloads itself on the next click, so unsent text in a dialog is lost; agents announce updates for that reason.
- Uncommitted work is on http://127.0.0.1:3001 (`npm run dev`). It uses its own database `data/dev.db`, never yours.
- One-time switch: stop the dev server on port 3000, then run `npm run live` (section 4).

---

## 2. Assumptions and sources

- **Perf-run lands first**, with exactly the two changes it A/B-tested (`PERF/variants/date`, `PERF/variants/trunc`):
  1. `DateControl.tsx:73` renders the popover content only while open (`content={isOpen ? … : null}`).
  2. Row `Text maxLines` is removed from the title, group labels and chips, ideally with a tokens-only CSS ellipsis on `.tessera-wi-title`, because work-items.css has none today.

  If perf-run lands more, drop the overlap from lanes B and C. If it lands less, those two changes become lane B's first item.
- **Fix round 6** is editing `TesseraShell.tsx`, `nav-collapse-store.ts`, `tests/e2e/helpers-d.ts`, `round5.spec.ts`, `tests/webhooks.test.ts` and `tests/workspace/home.test.ts`. No lane below touches those files.
- **Product decisions respected.**
  - Decision 12: freshness through ChangesPoller and `refresh()`. Nothing here caches data.
  - Decision 127: the cache lane stays dropped, and nothing here reopens it.
  - Decision 115: the budgets are measured on `next start`, which lane A makes your daily runtime too.
  - P12 decisions 127 to 139 are not re-decided. Section 7 says how they interact with this roadmap.
- **Your data size is unknown.** No lane opened `data/tessera.db`, by rule. Scale-dependent items wait for measurement M1, which needs your permission (needs-user item U1).

---

## 3. Decided table

Cost: S = under about 100 changed lines, M = 100 to 600, L = more. Ranks are global.

### Do now (next performance round, after perf-run)

| # | id | Decision | Why | Evidence | Expected effect | Cost | Risk |
|---|---|---|---|---|---|---|---|
| 1 | live-prod-server | **Lane A.** Daily Tessera runs `next start` through `scripts/live.sh` on 127.0.0.1:3000 against `data/tessera.db`. `next dev` moves to 3001 with `data/dev.db`. | The biggest felt cost is the dev runtime, not app code. A production build in its own `distDir` never disturbs a dev server. | Prefetch is prod-only (prefetching.md:64). Dev uses `<distDir>/dev` (next/dist/server/config.js:1106-1109). The build keeps cache, dev, lock and trace when it cleans (next/dist/build/index.js:620-633). Hard loads dev against prod: 589/202, 2164/889, 3457/1596, 797/309 ms. Crawl: 102.7 s dev cold against 2.1 s prod (PR/runtime/results). live.sh scenarios A to G pass (PR/runtime/results/final-test.out). | Hard loads 2 to 3 times faster. Instant prefetched skeleton at 33 to 106 ms on every sidebar click. Revisits ready in 34 to 121 ms. First visit 215 to 460 ms per session or after each update. No compile waits. No tab reloads when agents edit files. | M | Only committed work shows, 23 to 31 s after a commit. A stale tab hard-reloads on its next click (deploymentId skew protection, deploymentId.md). `?dpl=` busts the browser cache for every chunk on each update. Rolling back across a migration is unsafe, so lane A refuses it. Disk 96% used: about 0.6 GB in `~/.tessera-live` (3 releases of about 120 MB each, 210 MB build cache, node_modules as an APFS clone). |
| 2 | agent-live-rules | **Lane A.** Only the reconciler, or the agent you ask, runs `npm run live:update`, for a committed ref with a green gate, once per merged batch, and announces it. No agent starts, stops or kills anything on 3000. Edits to next.config.ts are batched and announced. | Cheap updates invite silent swaps while you click. | live.sh refuses a foreign port holder (exit 4) and a concurrent update (exit 3), but it cannot tell whether you are mid-task. Skeptic: it is a process rule, so it ships only together with live.sh. | No surprise reloads, and fewer uncoordinated build CPU spikes. | S | A rule nobody reads: keep it short (field guide plus docs/process/live.md). |
| 3 | field-guide-dev-build-rule | **Lane A.** Replace field-guide line 7. Since Next 16, dev (`.next/dev`) and build (`.next`) no longer clash. Wipe `.next/dev` only to repair a reload loop. Dev now runs on 3001. | The current rule throws away 1.4 to 2.3 GB of warm Turbopack cache for nothing. | config.js:1106-1109; build/index.js:620-633. Cold dev crawl 102.7 s against 37.2 s with the cache kept (PR/runtime/results/warmup-dev-*). Correction: a checkout build still rewrites `next-env.d.ts` (writeAppTypeDeclarations.js:52-74) until dev restarts. That is harmless, because the file is gitignored (.gitignore:44). | Saves 40 to 100 s of re-warm per checkout build (phase acceptance), not per agent build. | S | If the old reload-loop cause was something else, the repair step stays documented. |
| 4 | live-build-tsconfig | **Lane A.** Live builds type-check through `typescript.tsconfigPath: "tsconfig.build.json"`, which covers src only, and only when `TESSERA_LIVE_BUILD=1`. | `next build` re-checks 270 test files that `npm run check` already checked. | TypeScript takes 2.7 to 4.2 s of a 9 to 10 s warm build (runtime lane logs). tsconfigPath is documented (05-config/02-typescript.md:450-475). Skeptic: prefer it over `ignoreBuildErrors`, which "completely skips" the check. | About 3 to 4 s off each 23 to 31 s update. No runtime effect. | S | Drop it if the measured saving is under 2 s. |
| 5 | list-fanout-fix | **Lane B.** `WorkItemRow = memo(...)` with per-row props (`selected` boolean, `onToggle`). Stable handlers (`useStableCallback`). `shareStructure` on every list result and on `display`. Row controls read a new lean `ProjectRowContext`. The full `ProjectContext` stays unchanged (corrected claim). | React skips a memoized child only when its props are shallow-equal (react-dom-client.development.js:10213). Today the whole selection object, fresh closures and fresh RSC objects defeat that, and the project context changes on every write. | Prod 10k fixture, 200 rows: a tick takes 829 to 951 ms, 730 to 805 ms of it script (PR/skeptic2/probe/select-trace-1.json). Prototype (R/proto/memo-sharing.patch), counts per interaction: select 15,921 → 1,235; state pick 33,202 → 4,188; peek open 19,864 → 5,165; peek close 35,777 → 6,407; agent-write refresh 17,775 → 3,257. Memo alone left the refresh at 17,165, and without the lean context a state pick still cost 11,535. Corrections: about 4k of the prototype's drop was DayCell, which perf-run owns. AgentsSettings.tsx:188 reads `last_seen_at`, so the shared bundle must not be stripped. | A tick drops from about 0.9 s to about 0.1 s at 200 rows. A state pick or peek re-renders about one row. An agent write costs about −82 to −95% background CPU; today's refresh long tasks are already only 0.15 to 0.25 s, so this frees CPU rather than removing jank. | M | `useShared` sets state during render (the documented "storing information from previous renders" pattern) and must pass react-hooks 7 lint. 62 files use `useProject` / `useOptionalProject`: tsc enforces the lean types, so a stripped field cannot be read. The table and board are not covered (do-next and with-p12). |
| 6 | scroller-has-class | **Lane B.** Replace the two `.tessera-wi-scroller:has(.tessera-wi-group)` rules (work-items.css:248, :406) with `.tessera-wi-scroller--grouped`, set by WorkItemsScreen when the list is grouped. Leave every other `:has()`. | A skeptic bisect put the whole measurable `:has()` cost on these two rules. | HEAD prod 10k, 200 rows, n=3 to 4 interleaved: removing these 2 rules gives 6.50 → 5.94 s, the same as removing all 37 Tessera rules (5.82 to 5.96 s). The 34 Astryx rules and the other 35 Tessera rules show no effect (PR/skeptic2/probe/has-split.jsonl, has-bisect.jsonl). | About −9% of a grouped 10k list draw at HEAD. Probably less after perf-run's DOM halving (open measurement M7). Nothing visual changes. | S | The class must be set exactly when ListLayout renders groups. |
| 7 | peek-editor-lazy-with-preload | **Lane C.** PeekHost loads WorkItemDetail through `next/dynamic` from a new `peek-detail-lazy.tsx`. `preloadPeekDetail()` fires on idle, or on the first pointerover or focusin on a `.tessera-wi-row`, whichever comes first. **Promoted from do-next:** it is the largest remaining first-load lever on 12 routes. | `PeekHost.tsx:51` imports the detail statically and pulls the editor stack into every list route. `next/dynamic` is the documented split (02-guides/lazy-loading.md:171, :239). | Real builds, first-load gz: work-items 959 → 553 KB, cycles/[cycleId] 1080 → 679, views 962 → 556, modules 972 → 570, archives 961 → 557. Script −175 ms at CPU 4x (n=8, PR/assets/ab-samples.jsonl). Skeptic: about 40 to 60 ms at CPU 1x, and wi-list's total task time is unchanged because it is style- and render-bound. The first peek without preload took 755 ms (n=1) against 388 to 536 ms. | About −40 to −60 ms of parse per hard load or first visit of a list route. The first peek stays as fast as today when the preload has fired. | M | Preload must fire before the first click. A click during the first 300 ms waits for the chunk (measured in verify). The skeleton must match the detail's height. Specs that wait for `contenteditable` may need a wait. |
| 8 | bundle-size-budget | **Lane C.** `check:bundle` also enforces per-route first-load gz from `.next/diagnostics/route-bundle-stats.json` against a committed `scripts/bundle-baseline.json` (5% tolerance, `--update-baseline`). | Protects #7. Today nothing fails if the static import comes back. | check-bundle.ts only scans for forbidden strings. Skeptic: route-bundle-stats.json is an undocumented internal (build/index.js:2923), so read it defensively. | Prevents silent regressions of about 400 KB gz on 5 route families. | S | The file format may change with a Next upgrade: fail with a clear message and an update command. |
| 9 | week-start-primitive-snapshot | **Lane C.** `useWeekStart` subscribes with a number snapshot. The server snapshot is `fromServer ?? default`. | The first publish replaces the store object (workspace-settings-store.tsx:56-61), so every subscriber re-renders after hydration (DateControl in every row). | R/out-loadcommits-memo-lazy.json: a post-hydration commit with DateControl=96. Load cost 17,907 → 16,754 components (R/out-dev-small-memo-lazy-ws.json). | One full date-control pass fewer on every hard load (about 1.1k components, 7%). | S | SSR and the first client render must agree, so the server snapshot is unchanged. |
| 10 | sidebar-final-hrefs | **Lane C.** Sidebar.tsx:236 → `/your-work/summary`, :293 → `/analytics/overview`. Power K go-to (command-source.ts:221, :225) gets the same targets. The page redirects stay for typed URLs. | A link to a redirecting page prefetches the redirect, not the page. | PR/next/prefetch-probe-small.json: Analytics skeleton at 82 ms against 32 to 37 ms for direct links. Dev logs "Could not validate instant … NEXT_REDIRECT" and makes one extra request (PR/3840-dev-rc.log:26-41). | About 30 to 50 ms sooner on two links (not perceptible), and one dev error fewer. Hygiene, ranked low. | S | Keep the `isSelected` prefix checks. |
| 11 | hidden-route-and-nav-back | **Lane B verify step.** Re-measure the hidden-list refresh and the navigation back to the list on a prod build. | Next keeps up to 3 routes under Activity, hard-coded (bfcache-state-manager.js:13). A hidden list still re-renders on refresh. | R/out-large-refresh-cpu1.json: navigating back took an 8.0 s long task and 128.6k components. The hidden refresh rendered 69k components in 63 time-sliced commits, with no long task. | Confirms lane B shrinks the navigation back to a shell-sized commit. | S | none |

### Do next (the round after; ranked)

| # | id | Decision | Why and evidence | Expected effect | Cost |
|---|---|---|---|---|---|
| 12 | profile-post-fix-mount | Profile the list and table mount on a prod build after perf-run and lane B: what remains of about 410 / 810 ms at 48 rows and 1.1 / 5.5 s at 10k, and where the 709 ms longest task comes from. | Nobody has profiled the post-fix mount. After the fixes, the cost is per-row Astryx component weight. It feeds the P12 thresholds and #13. | Picks the next real lever instead of guessing. | S |
| 13 | table-pass | Table fan-out and mount: stable column definitions (TableLayout.tsx:320 rebuilds them on peek), then per-row memo if Astryx Table allows it. Measure first (#12). | The table is the slowest view: 813 ms at 48 rows and 5.5 s at 10k after perf-run. Read from source only. | Unknown until #12. | M |
| 14 | inbox-intake-detail-lazy | Reuse lane C's loader for `/inbox` (`DetailPage`) and intake (`IntakeDetail`), only if `graph-dominators.py` shows an editor share of 150 KB gz or more. | The skeptic verified that nothing auto-selects an item: both pages return null without `?item=`. The share is unmeasured (estimate 250 to 350 KB). | A one-time parse saving per first visit. | M |
| 15 | engine-counts-batch | `listProjects` without counts where they are thrown away. A covering index (`INDEXED BY work_item_live_state_idx`) for the counts that are shown. Home asks `getCounts` only for the parts it uses. Only if M1 shows thousands of items. | Confirmed: listProjects 5.6 → 1.2 ms and Home 85-103 → 27 ms at 10k. Nothing felt at a few hundred items (small.db 0.43 ms). | About −60 to −75 ms of Home server time at 10k. | S |
| 16 | candidate-lazy | Cycle and module "add items" candidates load when the dialog opens, with no new index and no migration (corrected claim). | cycle-data.ts:11 and modules/[moduleId]/page.tsx:21, :79 load 500 rows on every page load. About 17 to 21 ms of SQL at 10k plus about 100 KB of flight data. | About −6 to −19 ms per cycle or module page at 10k, and a smaller payload. | M |
| 17 | view-totals-count-only | Saved-view totals use a `COUNT` over `countsPopulation(...).where` instead of the full getCounts. | Equal totals on 13 scopes. 16.1 → 0.85 ms per view at 10k, about 2 ms per page today (skeptic1 probe). | A scale guard for many views on a big project. | S |
| 18 | slim-list-rows | Drop `description_md` from list and board rows, after M1 shows real description lengths. | Only 24 KB of a 3.66 MB 10k list page (0.7%) on fixture data. Material only with multi-KB descriptions. | Up to about 70% of the flight data when descriptions are long. | M |

### With P12 (fold into the P12 lanes; do not schedule separately)

| id | Decision | Why |
|---|---|---|
| collapsed-group-bodies | Already P12 V1.3: `ListGroupRows` renders no rows when `!isOpen` (p12-plan.md:534-545, :824). | The skeptic found it already planned. |
| windowed-rows-memo | P12's `ListGroupRows` renders lane B's memoized `WorkItemRow` with per-row props. | `useVirtualizer` re-renders its host on every range change. Without memo every range change re-renders every rendered row. |
| board-card-memo-drag | Memoize BoardCard and keep the drag-slot state per column, in the same change as P12's board windowing (60 cards per column). | One cross-column drag gave 5 full-board commits of 10.3k components each and 1.48 s of CPU (R/out-drag-large-cpu1.json, n=1). |
| react-compiler | After lane B and P12: `reactCompiler` plus `experimental.turbopackRustReactCompiler`, which needs no Babel plugin and no new dependency (turbopackRustReactCompiler.md "Good to know"). Production A/B at n of 5 or more. | 174 of 194 components on wi-list compile. It cannot fix RSC identity churn and does not compile Astryx. Decision 134 assumes the compiler is off, so its lint line must be revisited. |
| peek-without-list-rerender | Open the peek through native `pushState` only if the peek still misses its budget after perf-run, lane B and P12. | The ?peek RSC takes 14 to 31 ms. The cost is the list re-render, which lane B mostly removes. |
| peek-animation-frames | Measure decision 132's peek width animation at 200 rows after lane B. If frames exceed 34 ms, hold the list's width during the animation as well. | The list panel narrows on every frame and reflows about 200 rows. Never measured. |

### Needs you (real decisions only)

| id | Question | Why | Expected gain |
|---|---|---|---|
| U1 | May an agent run one read-only query on `data/tessera.db` (item counts per project, average description length, file size), or will you run it yourself? | Your rule forbids touching that file. Every scale-dependent item (#15, #16, #18, the cache_size and page-size revisits, the P12 thresholds) depends on your real size. | Decides 5 to 6 items with facts instead of guesses. |
| U2 | Approve `@next/playwright` as a dev dependency? (new dependency; check its licence at install) | It is the documented regression test for instant navigation (instant-navigation.md:140; optimizing-prefetching.md:353). `ensureStatic` cannot guard Tessera's App Shell (refuted, section 3a). | A test fails if a sidebar route loses its instant skeleton. No speed gain. |
| U3 | Start the live app at login with a macOS LaunchAgent? | It is standing configuration on your Mac. launchd's bare PATH and a forgotten old release are the risks. | Saves typing `npm run live` after a reboot (0.5 s start). Convenience only. |

The dropped `'use cache'` lane is **not** on this list. The evidence says the most it could save is the 12 to 42 ms prod navigation fetch, against the freshness model of decision 12. Your decision 127 stands and there is nothing new to ask.

### Do not (with the reason)

| id | Reason |
|---|---|
| lazy-date-and-truncation | Covered by perf-run. Do not duplicate. |
| ensure-static-shell-guard (refuted) | `'navigation'` fails the build on every database-reading route, even inside Suspense or with `instant = false`. `'shell'` and `'prefetch'` add no build check (ensureStatic.md "Validation", "How ensureStatic differs from instant"). See U2. |
| lazy-row-selectors (refuted) | −3% in dev at n=1 is noise. Astryx 0.6.8 Selector has no `lazyMount` (useLayer.d.ts:172-183 is context-mode only), so mount-on-intent would be glue. Revisit if Astryx adds it. |
| single-pass-counts (refuted) | Budgets pass on an idle machine with about 20% headroom (PERF/results/bench-2.txt). Run `perf:bench` idle instead of rewriting getCounts. |
| assistant-panel-and-markdown-lazy (refuted) | 3 to 10 ms per hard load at CPU 1x. Home task time 743 → 742 ms. It adds first-open latency and a digest fallback. |
| shell-refresh-fanout (refuted) | After lane B, a refresh has no long tasks (ltTotal 0, R/out-refresh-dev-final.json), and much of its CPU is Flight and router work. |
| phosphor-duotone-only (refuted) | About 4 ms at CPU 1x, and a generator to maintain for every icon and Phosphor upgrade. |
| list-total-covering-index (refuted) | About 1 ms with realistic rows. The list is already 10 times under budget (3.9 ms p95 against 40). |
| cache-size-64mb (refuted) | No effect until the working set exceeds 16 MB (better-sqlite3 deps/defines.gypi:13). Revisit after U1. |
| page-size-16k (refuted) | No gain at your scale. It needs an offline `journal_mode=DELETE` step before VACUUM. |
| ai-status-inline (refuted) | It would move `client.models.retrieve`, a call to the Anthropic API, into the shell's server render (ai/client.ts:71-95). Keep the client fetch. |
| layout-read-batching (refuted) | 0.4 ms per render. It is a consistency question, not speed. |
| command-bar-split (refuted) | 2 to 5 ms per hard load, and it adds first ⌘K latency. |
| fts-rowid-map (refuted) | 0.1 ms per write at your scale, and it needs a migration. |
| zod-out-of-shell (refuted) | About 30 KB (estimate), and 14 client modules use zod for runtime validation. |
| lowlight-language-subset (refuted) | A few ms once per first editor load, against a product loss. If it ever matters, register grammars lazily per fence. |
| next-font-local-vendored (refuted) | No runtime effect: fonts are already self-hosted, preloaded and subset. |
| logging-ignore-changes-poll, db-singleton-globalthis (refuted as perf) | Zero loading-time effect. Track them as hygiene outside this plan. |
| dev-validation-manual-agents | No segment exports `instant = true`, so `'manual-warning'` turns validation off entirely, on exactly the worker servers that write routes. Daily use moves to prod anyway. |
| dev-strict-mode-and-tuning-flags | The lanes disagree on dev-only gains, it hides effect bugs where P12 adds effects, and the question is moot on the live app. |
| link-pending-hint | `useLinkStatus` reports only routes that were not prefetched, and in prod every sidebar link is prefetched. |
| warmed-dev | It treats the symptom: 28 to 103 s of CPU per start, and dev still 2 to 3 times slower than prod. |
| recharts-lazy | The charts are the page content. Lazy loading only shows them later. |
| compression-changes, bundle-css-config-knobs, dev-turbopack-flags, already-fine-assets | Measured: nothing measurable, or already optimal (CSS 55 KB gz with 72 to 74% used, fonts 50 KB preloaded, no images). |
| drop-yjs-tiptap-features | A product regression for an unmeasured gain. The editor becomes lazy anyway (#7). |
| engine-rejected, react-rejected | Statement cache, ANALYZE, mmap, a worker thread, externalising Drizzle, assistant memo, more Activity routes and deferred filters: measured as no gain or as a risk. |
| gatekeeper-developer-mode | No Gatekeeper cost observed in three dev crawls. It would weaken a macOS security setting. |
| Not re-decided: caching (`'use cache'`, `staleTimes.dynamic`, `cachedNavigations`, `unstable_dynamicOnHover`) | Your decision 127 stands. The evidence (at most 12 to 42 ms per navigation, against decision 12 freshness) gives no reason to ask again. |

### 3a. Refuted claims and corrections

| Claim in the draft | Verdict | Reason (skeptic) |
|---|---|---|
| "Light-page clicks ready in tens of ms" | partly | True for revisits only (34 to 121 ms). The first visit per session is 215 to 460 ms, the list 627 to 967 ms. Home shows "0/5 prefetched" because it is already kept under Activity. |
| ensureStatic guards the App Shell and allows relaxing dev validation | refuted | See do-not. Instant validation is dev-only at the default level (instant.md:61-63, :117). |
| Lazy row Selectors save about 40% of DOM, with a real time gain | refuted | The DOM drops, but the time gain is noise, and the change would be glue. The truncation was the real hotspot (4780 → 1902 ms in the same profile), and perf-run handles that. |
| getCounts and analytics miss the budget | refuted | Only on a saturated machine (load 14 to 22). They pass at load 4.5. |
| Lean context strips cursor, counts, progress and last_seen_at from the shared bundle | corrected | AgentsSettings and planning screens read them. Use a separate lean row context. |
| External-write wall time 2.0 to 6.5 s is jank | corrected | It is mostly poll wait plus the round trip. The refresh renders in a transition with 147 to 244 ms of long tasks. |
| Peek lazy load "−175 to −225 ms" | corrected | That was at CPU 4x. About 40 to 60 ms at 1x, and wi-list total task time is unchanged. Preload on idle or intent, not on pointerdown alone. |
| All 71 `:has()` rules cost 12% | corrected | Only 2 scroller rules matter (about −9%). |
| Collapsed group bodies are a separate item | corrected | Already in P12 V1.3. |
| Week-start fix "a quarter of load components" | corrected | About 7% (1.1k) once perf-run's lazy date lands, and on hard loads only. |
| Field-guide fix saves the re-warm "after every agent build" | corrected | Only for builds in the checkout. Agents build in scratch copies. `next-env.d.ts` is still rewritten. |
| Slim list rows: about 75% smaller payload | corrected | 0.7% of the page on fixture data. It matters only with multi-KB descriptions. |
| Server data cache could join the App Shell | corrected | URL-dependent reads cannot (adopting-partial-prefetching.md:87). Decision 109 used revision keys, not tags, for external writers. |
| page_size VACUUM renumbers FTS rowids | corrected | FTS5 rowids survive VACUUM (skeptic1 scratch test). The real catch is that WAL mode ignores the page-size change. |
| Candidate lists: add an index or load lazily | corrected | Load lazily, with no index and no migration. |
| Agent rules are a standalone do-now | corrected | They ship only with live.sh. The port rule is reworded. |

---

## 4. Daily-use setup (after lane A merges)

The one recommended way: **the live app on http://127.0.0.1:3000.**

```bash
# One time (you, or an agent you ask in chat). Stop the dev server that holds port 3000:
kill $(lsof -tiTCP:3000 -sTCP:LISTEN)
cd ~/Documents/Github/tessera && npm run live      # first build of the committed HEAD takes about 40 s, then serves :3000

# Every day / after a reboot:
cd ~/Documents/Github/tessera && npm run live      # starts the newest release in about 0.5 s

# After work is merged (the reconciler normally runs this and tells you; you can too):
npm run live:update      # builds HEAD in about 25-30 s while the old server keeps serving, swaps in under 1 s
npm run live:status      # live, previous and HEAD shas, listener pid
npm run live:rollback    # back to the previous release (refuses across a database migration)
npm run live:stop

# Only to look at uncommitted work: http://127.0.0.1:3001, with its own database data/dev.db
npm run dev
```

What lane A adds for this: `scripts/live.sh`, five npm scripts (`live`, `live:update`, `live:rollback`, `live:stop`, `live:status`), `npm run dev` on 3001 with `TESSERA_DB_PATH` defaulting to `data/dev.db`, one `distDir` line in next.config.ts, and `docs/process/live.md`.

Until lane A merges, nothing changes: keep `next dev`. Lane A has no overlap with fix round 6 or perf-run, so it can start first.

---

## 5. Lane contract

Rules for all three lanes:
- The file lists are disjoint. Each lane stays at about 600 changed lines or fewer, and no file grows past 600 lines (scripts/file-budget.json).
- Every changed behaviour gets a Vitest (`*.test.ts` only; render with `createElement`, field guide), and the area's `docs/as-built/*.md` is updated.
- `npm run check` must be green.
- The root planner adds decisions 140 to 142, provisional numbers after P12's 139, to docs/PLAN.md and PLAN-STATUS.md before the lanes start, so no lane edits the PLAN.
- Lane A can start now. Lanes B and C start after perf-run's quick wins merge, and before P12 V1 (lane B shares ListLayout.tsx with P12 V1.3; lane C shares Sidebar.tsx with P12's sidebar work, decisions 128 to 131).
- **A/B protocol** for every timing metric: two production builds in scratch copies, base = main after perf-run and lane = the lane's tree. Use fresh copies of `PERF/data/small.db` and `PERF/data/p11-perf.db`, interleave A, B, A, B, n of 5 or more, at load below 8, and record `uptime`. Adapt the hard-coded ports in the copied PERF and PR scripts to the ports the round's planner assigns. Component counts (R/devcount.mjs, R/refresh-dev.mjs) are deterministic and need n=1 per variant.

### Lane A: live app (decision 140)

**Files:**
- `scripts/live.sh` (new)
- `docs/process/live.md` (new)
- `package.json`
- `next.config.ts`
- `tsconfig.build.json` (new)
- `.claude/launch.json`
- `.gitignore`
- `docs/field-guide/index.md`
- `docs/process/swarm.md`
- `README.md`
- `docs/as-built/engine.md`
- `tests/live-script.test.ts` (new)
- `tests/next-config.test.ts` (new)

**Exact changes:**

1. `scripts/live.sh`: start from `PR/runtime/live.sh` (96 lines, scenarios A to G passed), with these changes:
   - Drop the `sed` patch of next.config.ts; the repo now carries the line.
   - Replace the `python3` timers with `node -e`.
   - Build with `TESSERA_LIVE_BUILD=1`.
   - Write `<release>/.tessera-migrations`, the number of entries in the exported `drizzle/meta/_journal.json`.
   - `rollback` exits 5 when the target release has fewer migrations than the live one, unless given `--force`. It then prints the newest `data/backups/tessera-migration-*.db` and the `npm run db:restore` command. (getDb's migrateIfNeeded already makes that backup, migrate.ts:124-143.)
   - Keep the actions key file at mode 600 (`umask 077`).
   - Exclude `/*.tsbuildinfo` from the `rsync --delete`.
   - Make `status` say whether live equals HEAD.
   - Keep everything else: the lock (exit 3), the foreign-port refusal (exit 4), the absolute DB (exit 2), the scratch build DB with automations and webhooks off during the build, `nice -n 10`, `NEXT_DEPLOYMENT_ID=<sha>`, the fixed `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (self-hosting.md:163), 3 releases, and the `/api/changes?since=0` health check.

   The live server itself runs with automations and webhooks on, because it is your app.
2. `next.config.ts`:
   - `distDir: process.env.TESSERA_DIST_DIR || ".next"`
   - `typescript: { tsconfigPath: process.env.TESSERA_LIVE_BUILD === "1" ? "tsconfig.build.json" : "tsconfig.json" }`

   `tsconfig.build.json` extends `tsconfig.json` and includes `next-env.d.ts`, `src/**/*` and the build's types folder.
3. `package.json`:
   - Add `live`, `live:update`, `live:rollback`, `live:stop` and `live:status` (`bash scripts/live.sh <cmd>`).
   - Set `dev` to `TESSERA_DB_PATH=${TESSERA_DB_PATH:-data/dev.db} next dev -H 127.0.0.1 -p ${PORT:-3001}`.
4. `.claude/launch.json`: run `npm run dev`, port 3001. `.gitignore`: add `/.next-*/` for agents building with `TESSERA_DIST_DIR=.next-probe`.
5. Field guide: replace line 7 with two lines, so the file stays at 80 or fewer.
   - The user's live app is on 3000. Never start, stop or kill anything there. Only the reconciler, or the agent the user asks, runs `live:update`, after a green gate, and says so.
   - Dev on your own port with `TESSERA_DB_PATH` (`npm run dev` = 3001 + data/dev.db). Dev and build no longer clash since Next 16. Wipe `.next/dev` only for a reload loop. A checkout build rewrites `next-env.d.ts` until dev restarts.
6. `docs/process/swarm.md`, "Verification per phase": one paragraph on the live update after each merged batch, by the reconciler only, announced, with next.config.ts edits batched and announced.
7. `docs/process/live.md`: the runbook. It covers commands, exit codes 1 to 5, logs in `~/.tessera-live/logs`, migrations and rollback, disk use, the stale-tab reload, and that only committed work is served.
8. `README.md`: update the run section. `docs/as-built/engine.md`: add scripts/live.sh to the scripts map. Ask the root to update the auto-memory note "preview server hangs … at 127.0.0.1:3000" to 3001.

**Tests:**
- `tests/live-script.test.ts`. It spawns `bash scripts/live.sh` with a temporary `TESSERA_LIVE_ROOT`, an ephemeral port and no build:
  - status on an empty root prints `live=none`;
  - a relative DB exits 2;
  - an existing lock exits 3 without exporting;
  - a foreign listener makes `stop` exit 4 and the listener survives;
  - rollback without a previous release exits 1;
  - rollback to a release with fewer migrations exits 5 and prints the restore hint.
- `tests/next-config.test.ts`: `distDir` and `tsconfigPath` follow the env vars, and `tsconfig.build.json` extends `tsconfig.json`.

**Verify (indicative, scratch `TESSERA_LIVE_ROOT`, port and DB, never 3000):**
1. `live.sh update` twice and `live.sh rollback` while `PR/runtime/poller.mjs` polls. Run it n=3 with and without `TESSERA_LIVE_BUILD=1` to measure the tsconfig saving.
2. A scratch branch with a type error must exit 1 while the old server keeps answering 200.
3. `PR/runtime/browser-probe.mjs` and `PR/next/prefetch-probe.mjs` against the live port.
4. `PR/runtime/tab-vs-build.mjs`: an open dev tab sees 0 reloads during a `TESSERA_DIST_DIR=.next-probe` build, and `.next/dev/cache` stays intact.

**Metrics to beat:**
- Hard loads at load below 8, n=5: Home ready ≤ 250 ms (dev 589, prod 202), wi-list hydrated ≤ 950 ms (2164 / 889), work item ≤ 350 ms (797 / 309), TTFB ≤ 5 ms (73 to 94 in dev).
- Every sidebar target except Home prefetched before the click, skeleton ≤ 110 ms.
- Swap outage ≤ 1.0 s (736 to 908 ms). Warm update ≤ 31 s, and ≤ 28 s with the build tsconfig.
- The failing build leaves the old server serving. Rollback across a migration is refused.

### Lane B: redraw only what changed (decision 141)

**Files:**
- `src/components/work-items/stable.ts` (new)
- `src/components/work-items/ListLayout.tsx`
- `src/components/work-items/WorkItemsScreen.tsx`
- `src/components/work-items/use-selection.ts`
- `src/components/work-items/use-paged-list.ts`
- `src/components/work-items/project-provider.tsx`
- `src/components/work-items/properties/{AssigneeControl,CycleControl,DateControl,EstimateControl,LabelControl,ModuleControl,StateControl}.tsx`
- `src/components/styles/work-items.css`
- `tests/ui/stable.test.ts` (new)
- `tests/ui/list-row-memo.test.ts` (new)
- `tests/ui/project-row-context.test.ts` (new)
- `tests/ui/wi-scroller-css.test.ts` (new)
- `tests/ui/use-paged-list.test.ts`
- `docs/as-built/work-items.md`

**Exact changes** (start from `R/proto/memo-sharing.patch`, 119+/24−; drop its DateControl lazy hunk, which perf-run owns, and every `console.log` / `firstDiff` debug line):

1. `stable.ts` holds three helpers:
   - `useStableCallback`: fixed identity; the ref is assigned in `useLayoutEffect`; never call it during render.
   - `shareStructure(prev, next)`: plain objects and arrays only. It returns `prev` when deep-equal and reuses every equal subtree.
   - `useShared(value)`: setState during render, converging in one extra render.
2. ListLayout:
   - `const WorkItemRow = memo(function WorkItemRow(...))` with `selected?: boolean` and `onToggle?: (id, shift) => void` in place of `selection`.
   - GroupSection passes `selected={selection ? selection.selected.has(item.id) : undefined}` and `onToggle={selection?.toggleId}`.
   - No inline closures reach a row; check with `R/why.mjs`.
3. WorkItemsScreen:
   - `display = useShared(displayProp)`.
   - `onUpdate`, `onOpen`, and any other handler that reaches rows go through `useStableCallback`.
   - `LayoutContent` gets `className` `"tessera-wi-scroller tessera-wi-scroller--grouped"` exactly when ListLayout renders groups (`display.layout === "list"` and `display.group_by`; confirm against ListLayout's branch).
4. use-selection: `toggleId` goes through `useStableCallback`. use-paged-list: `setResult(shareStructure(...))` on a new server result and on every page merge.
5. project-provider:
   - Add `ProjectRowContext` and `useProjectRow()`, provided by both `ProjectProvider` and `ProjectScope`. Its value is `shareStructure` of a lean projection with lean types, for example `Omit<Cycle, "progress" | "open_count">` and actors without `last_seen_at` / `updated_at`, plus the derived maps.
   - The full `ProjectContext` is unchanged.
   - Grep `ProjectContext.Provider` so that no other provider path misses the row context.
6. The seven row controls switch from `useProject()` to `useProjectRow()`, and tsc rejects any read of a stripped field. They also serve the detail and peek, which keep working because the same providers supply both contexts.
7. work-items.css:248 and :406: `.tessera-wi-scroller:has(.tessera-wi-group)` becomes `.tessera-wi-scroller--grouped`. Same declarations.
8. Lint: `npm run lint` (react-hooks 7) must pass with no new disables.

**Tests:**
- `stable.test.ts`:
  - equal input returns the `prev` identity;
  - one changed leaf creates new objects only along its path;
  - array length changes are handled;
  - a Date or Map passes through;
  - `useStableCallback` keeps one identity and calls the latest closure.
- `list-row-memo.test.ts`. It renders ListLayout with 20 rows in jsdom and counts `ListItem` renders through a `vi.mock` wrapper:
  - toggling row 3 renders 1 row;
  - a structurally equal new result renders 0 rows;
  - one item's state change renders 1 row.
- `project-row-context.test.ts`: a bundle with a new cursor, `last_seen_at`, progress or counts keeps the row-context identity; a renamed state changes it.
- `wi-scroller-css.test.ts`: there is no `.tessera-wi-scroller:has(` rule, and the grouped class carries the scroll padding.
- `use-paged-list.test.ts`: a refresh with equal data keeps the item identities.

**Docs:** work-items.md gets a "Render identity" section. Known debt: table and board are not memoized (#13, with-p12).

**Verify:**
1. Run `R/devcount.mjs`, `R/why.mjs`, `R/refresh-dev.mjs` and `R/logwatch2.mjs` (dev, small fixture, deterministic counts).
2. On prod builds A/B:
   - `PR/skeptic2/probe/select-trace.mjs` (10k fixture, 200 rows, CPU 1x, n=3);
   - `R/interactions.mjs` and `R/refresh.mjs` (also covers the navigation back to the list, #11);
   - the `PR/skeptic2/probe/has-split.mjs` pattern between builds (grouped inbox → list at 10k, n=4);
   - the `PERF/scripts/code-ab-prod2.sh` pattern for no regression in list and table ready.
3. The list, peek, selection and quick-add e2e specs in a scratch copy.

**Metrics to beat:**
- Counts per interaction, dev, 48 rows:
  - select ≤ 1,500 components (15,921 at HEAD, about 11.8k after perf-run), and WorkItemRow renders per tick ≤ 1 (48);
  - state pick ≤ 4,500 (33,202);
  - peek open ≤ 5,500 (19,864);
  - peek close ≤ 6,500 (35,777);
  - agent-write refresh ≤ 3,500 (17,775).
- Prod, 10k fixture, 200 rows: tick task ≤ 200 ms (829 to 951); agent-write refresh ≤ 6k components (69k); report the longest task on the navigation back to the list (8.0 s at HEAD; target ≤ 1.5 s, projected).
- Grouped 10k list draw ≥ 6% faster than base.
- List and table ready within +3% of base, so nothing regresses.

### Lane C: load less up front (decision 142)

**Files:**
- `src/components/detail/PeekHost.tsx`
- `src/components/detail/peek-detail-lazy.tsx` (new)
- `src/components/shell/Sidebar.tsx`
- `src/components/shell/command-source.ts`
- `src/components/workspace-settings/workspace-settings-store.tsx`
- `scripts/check-bundle.ts`
- `scripts/bundle-baseline.json` (new)
- `tests/ui/peek-lazy.test.ts` (new)
- `tests/ui/week-start-snapshot.test.ts` (new)
- `tests/ui/sidebar-links.test.ts` (new)
- `tests/check-bundle-budget.test.ts` (new)
- the peek e2e specs that need a wait (inside the spec files, never `helpers-d.ts`, which fix round 6 owns)
- `docs/as-built/shell-detail.md`
- `docs/as-built/hardening.md`
- `docs/as-built/workspace.md`

**Exact changes:**

1. `peek-detail-lazy.tsx` (`"use client"`):
   - `export const LazyWorkItemDetail = dynamic(() => import("./WorkItemDetail").then((m) => m.WorkItemDetail), { loading: () => <the peek's existing Skeleton at the detail's height> })`, declared at module top level (lazy-loading.md:239).
   - `export function preloadPeekDetail()`: an idempotent `import("./WorkItemDetail")`.
   - A pure `schedulePreload(win, fn)`: `requestIdleCallback` with a 1500 ms `setTimeout` fallback, plus one `pointerover` / `focusin` listener on `document` filtered by `closest(".tessera-wi-row")`, removed after it fires.

   PeekHost renders `LazyWorkItemDetail` and calls `schedulePreload` once on mount. Its static `./WorkItemDetail` import goes away. Keep `workItemPath` from DetailHeader only if DetailHeader does not pull the editor; route-bundle-stats shows whether it does.
2. Sidebar.tsx:236 `href="/your-work/summary"`, :293 `href="/analytics/overview"`, with the `isSelected` checks unchanged. command-source.ts:221 and :225 get the same targets. The page redirects stay.
3. workspace-settings-store.tsx, `useWeekStart`:
   - `getSnapshot = () => (state.isPublished || fromServer === undefined ? state.week_start : fromServer)`;
   - `getServerSnapshot = () => fromServer ?? DEFAULT_STATE.week_start`;
   - it returns `toWeekStart(number)`.
4. check-bundle.ts:
   - Read `.next/diagnostics/route-bundle-stats.json` defensively, with a clear error naming the file and the expected shape.
   - Compute first-load gz per route from its chunk list, deduplicated and cached.
   - Compare against `scripts/bundle-baseline.json` with 5% tolerance and print a table. `npx tsx scripts/check-bundle.ts --update-baseline` rewrites the baseline.
   - The existing forbidden-string scan is unchanged.

**Tests:**
- `peek-lazy.test.ts`: no static `./WorkItemDetail` import is left in PeekHost; `schedulePreload` fires once on idle, once on the first row pointerover, and never twice (fake timers).
- `week-start-snapshot.test.ts`: a counting subscriber does not re-render on a first publish with an unchanged week start, and does on a change.
- `sidebar-links.test.ts`: the hrefs are final, and `isSelected` stays true on `/your-work/assigned` and `/analytics/work-items`.
- `check-bundle-budget.test.ts`: passes under the budget, fails above 5%, and gives a clear error on a missing file or a changed shape.

**Docs:**
- shell-detail.md: the lazy peek detail and its preload, and the final sidebar hrefs.
- hardening.md: the byte budget and its update command.
- workspace.md: the week-start snapshot.

**Verify:**
1. A prod build: the route-bundle-stats table from check-bundle.
2. `PR/assets/probes/route-assets.mjs` A/B at 375 px, CPU 4x and 1x, n=8.
3. `PR/next/peek-probe.mjs` with the click 2 s after load and 300 ms after load (n=5 each), counting scripts fetched after pointerdown.
4. `PR/next/prefetch-probe.mjs` step "click nav Analytics".
5. `R/loadcommits.mjs` and `R/devcount.mjs` LOAD.
6. A scratch build that restores the static import must fail `check:bundle`.
7. The peek and detail-editor e2e specs in a scratch copy.

**Metrics to beat:**
- First-load gz: work-items ≤ 560 KB (959), cycles/[cycleId] ≤ 690 (1080), views ≤ 565 (962), modules ≤ 580 (972), archives ≤ 565 (961), and no route grows more than 1%.
- wi-list script at CPU 4x ≤ base − 150 ms (1331 → 1157 at HEAD); report the 1x figure (expect −40 to −60 ms).
- Peek after idle: 0 scripts after pointerdown, and click to editor ≤ base + 20 ms (about 255 ms small after perf-run). Report the 300 ms early-click case.
- Analytics skeleton ≤ 50 ms with a prefetched shell (82).
- No post-hydration commit containing DateControl, and LOAD ≤ base − 1,000 components.

---

## 6. Order of work

1. Now: lane A (independent).
2. After perf-run's quick wins merge: lanes B and C in parallel. Their files are disjoint. Lane B rebases on perf-run's `DateControl.tsx` and `ListLayout.tsx` changes.
3. After the merge: the reconciler runs `npm run live:update` once and announces it. Then #12 (profile the post-fix mount), before P12 V1 picks its thresholds.
4. P12, with the "With P12" items above folded into its lanes.

## 7. How this meets P12 (decisions 127-139, not re-decided)

- **Windowing never touches the default page.** Decision 135 windows above 250 rows, but the default page is 200 rows (paging.ts `ROW_PAGE`), and the 10k fixture renders 213. The default page's speed therefore comes only from per-row cost: perf-run's two fixes, lane B, and whatever #12 finds.
- **Decision 115's list budget will probably still fail at 10k after this round.** The projection is about 1.0 to 1.1 s against 300 ms: about 4 ms per row plus a base of about 200 ms, from 412 ms at 48 rows and 1.12 s at 213 rows. P12 should re-read its thresholds with the numbers from #12 and the decision 115 spec (`PERF/spec/perf.spec.ts`; HEAD p95 list 13.3 s, table 35.7 s, board 344 ms).
- **Windowed rows must be memoized.** `useVirtualizer` re-renders its host on every range change, so P12's `ListGroupRows` must render lane B's `WorkItemRow`. Collapsed groups are already V1.3.
- **The 300 ms motion (decision 132).** The peek transition can hide part of a late editor chunk, but lane C's preload should make that unnecessary. The animation narrows the list on every frame, so measure frame times at 200 rows after lane B (with-p12 "peek-animation-frames").
- **Decision 138's scroll budget is measured on `next start`.** Run it through a scratch live root (`TESSERA_LIVE_ROOT`, `TESSERA_LIVE_PORT`, `TESSERA_LIVE_DB`), never the user's.
- **Lane B and P12's board windowing.** Lane B does not touch the board. Board card memo and the drag state go into P12's board change.

## 8. Open measurements

| id | What | Why it matters |
|---|---|---|
| M1 | Your real data: items per project, average `description_md` length, DB file size (needs U1) | Decides #15, #16, #18, the cache_size and page-size revisits, and the P12 thresholds |
| M2 | Post-fix list and table mount profile (#12): the 709 ms longest task at 10k, and what fills 410 / 810 ms at 48 rows | The next lever after this round. The table is the slowest view |
| M3 | First visit to a light route per session (215 to 460 ms against 59 to 95 ms warm): chunk evaluation against first render, on cycles, inbox and analytics | Whether lane C or #14 helps beyond list routes |
| M4 | The decision 115 Playwright spec after perf-run and lane B (list, table, board p95 at 10k) | Whether the budget is reachable without P12 |
| M5 | Lane B's prod effect at 200 rows and at CPU 4x (projected from dev counts and one trace), plus the table and board fan-out | Confirms the "0.1 s per tick" promise |
| M6 | First peek with idle preload, n of 5 or more, including a click before idle | Confirms #7 has no penalty |
| M7 | The scroller `:has()` gain after perf-run's DOM halving, and at small scale | Sizes #6 |
| M8 | Perf-run's blocking-navigation A/B (PERF/results/nav-ab-small-*.json) is mixed: at CPU 1x cold, cycles 386 → 152 ms and inbox 215 → 73 ms; at 4x, cycles 389 → 583 ms | Perf-run's call. Listed so it is not lost |
| M9 | live.sh paths not yet exercised: a failing build, swap outage at load above 40 (an earlier loop saw 6.2 s), the tsbuildinfo effect, launchd (U3) | Lane A's verify covers the first three |
| M10 | Editor share on /inbox and intake (`PR/assets/probes/graph-dominators.py`) | Gates #14 |
| M11 | Never measured: filter-bar typing (router.replace round trip), long assistant transcripts, Inbox and bulk actions, scheduler CPU inside the live server | Candidates for a later round |
| M12 | Split of the 1.1 MB (48 rows) / 3.66 MB (10k) list HTML into markup and flight data after perf-run (flight is 327 KB at 10k) | Decides whether the SSR markup or the payload is next |

## 9. Artifacts to copy into docs/drafts before /tmp is wiped

Copy these into `docs/drafts/perf-2026-10-24/` (the root planner does this; agents never commit):
- this file;
- `PR/runtime/live.sh`, `PR/runtime/poller.mjs`, `PR/runtime/browser-probe.mjs`, `PR/runtime/tab-vs-build.mjs`;
- `R/proto/memo-sharing.patch`, `R/proto/stable.ts`, `R/devcount.mjs`, `R/why.mjs`, `R/refresh-dev.mjs`, `R/refresh.mjs`, `R/interactions.mjs`, `R/loadcommits.mjs`, `R/lib.mjs`;
- `PR/next/prefetch-probe.mjs`, `PR/next/peek-probe.mjs`;
- `PR/assets/probes/route-assets.mjs`, `PR/assets/probes/graph-dominators.py`;
- `PR/skeptic2/probe/select-trace.mjs`, `PR/skeptic2/probe/has-split.mjs`, `PR/skeptic2/probe/perf-init.mjs`;
- `PERF/scripts/code-ab-prod2.sh`, `PERF/scripts/code-wi-sample2.mjs`, `PERF/scripts/perf-init.mjs`, `PERF/scripts/routes.mjs`, `PERF/scripts/nav-init.mjs`, `PERF/spec/`;
- `PERF/perf-report-2026-10-24.md`, once it exists.

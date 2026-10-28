# Perf-run probes and HEAD baseline (2026-10-24)

These are the measurement scripts of the 2026-10-24 performance run and the baseline medians it took on git `d26461b`. They are kept here because the /tmp scratchpad gets wiped (field guide). The roadmap's lanes re-run some of them in their verify steps (lane B names the `code-ab-prod2.sh` pattern). None of this is product code.

- `scripts/`: the probes, copied unchanged. `home-bench.ts.txt` and `shell-reads-bench.ts.txt` are TypeScript, renamed because `tsc` includes `**/*.ts`.
- `baseline/`: the HEAD medians these probes produced, the numbers later runs compare against.
- The decision 115 browser budget now has its own spec: `tests/e2e/perf.spec.ts` with `playwright.perf.config.ts` (docs/as-built/hardening.md, section 7). `baseline/perf-spec.json` is its n=20 HEAD run.

## Before you run anything

The scripts carry the values of the 2026-10-24 run. Change them first:

- **Ports 3800 to 3805 are hard-coded.**
  - `code-ab-prod*.sh` use 3802.
  - `routes.mjs` uses 3804 (small set) and 3805 (10k set). `nav.mjs`, `browser-load.mjs`, `server-timing.mjs`, `interactions.mjs`, `hidden-route.mjs` and `reveal-large.mjs` take their port from it.
  - `nav-ab.mjs` uses 3804 and 3805 for its two arms.
  - `dev-ab-coldwarm.sh` uses 3800, and `dev-server.sh` refuses any port but 3800 and 3801.
  - Pick ports nobody else uses. Never use 3000 (the user's server).
- **Scratchpad paths are hard-coded:** `/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf` (`SP=` or `S=` at the top of the `.sh` files). That folder held:
  - the copies `code/` (HEAD), `code-exp/` (experiment), `dev/` and `prod/`;
  - `variants/` (the file sets `code-set-variant.sh` copies);
  - `data/` (seeded databases) and `results/`.
  - `dev-hmr.mjs` refuses to edit a copy whose path lacks `/scratchpad/perf/`.
  - Several scripts resolve paths against their own folder: `nav.mjs`, `nav-ab.mjs`, `browser-load.mjs`, `server-timing.mjs`, `interactions.mjs`, `hidden-route.mjs`, `reveal-large.mjs` and `bundles.mjs` write to `../results/`, `summarize.mjs` reads it, and `interactions.mjs` opens `../prod/data/p11-perf.db` or `../prod/data/small.db`. Run them from a folder laid out the same way, or edit the paths.
- **Database ids are hard-coded:** the project, item, cycle and page ids of the two seeded files in `routes.mjs`, `dev-common.mjs`, `code-ab-prod*.sh` (`PROJECT`) and `code-dev-bg-cpu.mjs`. A new seed gets new ids. Look them up in the database, or open `/projects/PERF`, which redirects to the 10k project's id (the perf spec does this).
- **Packages:** the scripts import `@playwright/test` or `playwright`. Node finds them by walking up to the repository's `node_modules`, so run them inside a checkout copy. In the scratchpad they reached them through a `node_modules` symlink; never copy that link.
- **Databases:** run against a production server (`next build`, then `next start`) or a dev server from a scratch copy, on a fresh copy of a fixture database, with `TESSERA_AUTOMATIONS=off`, `TESSERA_WEBHOOKS=off` and no `ANTHROPIC_API_KEY`. Never use `data/tessera.db`.
  - Small set: a migrated copy of a ~50-item workspace.
  - 10k set: `npm run perf:seed -- --db data/p11-perf.db` (decision 115 fixture).
  - `code-inline-edit.mjs` and `interactions.mjs` write to the database.

## A/B protocol

The machine runs other agents, so single numbers mean little:

1. Interleave the arms: A, B, A, B, … in one loop. Never all of A, then all of B.
2. Take n ≥ 5 per arm and compare medians (`code-ab-median.mjs` reads the jsonl the A/B scripts write). State n.
3. Record `uptime` with every sample. The A/B scripts write the load averages next to each sample, and the baseline files carry them. A run whose load rose above about 8 is noisy: say so, or repeat it.
4. For production A/B, start and stop `next start` per sample (`code-ab-prod2.sh`), so neither arm keeps a warm process. Give each arm its own fresh database copy.
5. For dev, a cold start means `rm -rf .next/dev` before `next dev` (`dev-server.sh start … cold`). The dev log line `GET /x 200 in N ms (next.js: …, application-code: …)` is the server-side signal (`dev-common.mjs` parses it).
6. For CPU-bound cases, add a 4x throttle (CDP `Emulation.setCPUThrottlingRate`; the scripts take `cpu4` or a rate argument).

"Ready" is the `[data-list-ready]` marker when the target has one. Otherwise it is visible main content with no visible skeleton (`perf-init.mjs`, `dev-init.mjs`, `nav-init.mjs`).

## The probes

Production, browser (Playwright, chromium):

| Script | What it measures |
|---|---|
| `perf-init.mjs` | In-page instrumentation shared by the browser probes: FCP, LCP, long tasks, and `window.__perf.ready` / `.hydrated` for a ready selector. |
| `routes.mjs` | Route lists, ports and ids of the small and 10k sets. |
| `browser-load.mjs` | Hard load per route in a fresh context (cold HTTP cache), routes interleaved per round. Desktop is 1440x900; mobile is 375x812, touch, CPU 4x. |
| `server-timing.mjs` | Server only: TTFB, total, chunk count, and when key markers first appear in the streamed HTML, per route. |
| `nav-init.mjs` | In-page click-to-ready timer: `__arm(spec)` takes the next pointerdown or keydown as t0 and polls each frame for the target. |
| `nav.mjs` | Client navigation Home → Projects → Work items → Cycles → Inbox → Analytics → Home, click to ready per step, cold then warm client cache. Also records whether the RSC prefetch finished before the click. |
| `nav-ab.mjs` | The same sequence as an interleaved A/B of two builds (the run compared HEAD with a build that blocks the inbox and cycles pages). |
| `interactions.mjs` | 10k set: peek open from the list, state change from the peek, board "Move to", list quick add, Power K open and search. Input event to visible result, plus the server round trip behind each. |
| `hidden-route.mjs` | Whether a visited, now hidden work-items route costs main-thread time on later navigations. |
| `reveal-large.mjs` | 10k list hard load, normal versus every JS chunk blocked: how much of the time is client work. |
| `bundles.mjs` | First-load JS per route from `.next/diagnostics/route-bundle-stats.json`, gzip sizes, the largest chunks and the packages in them. |
| `summarize.mjs` | Collects the measure-prod results into one metrics list (`baseline/metrics.json`). |

Code experiments (the rows fixes: lazy date-picker content and no `maxLines` on row texts):

| Script | What it measures |
|---|---|
| `code-wi-sample.mjs` | One sample: hard load of the work-items list, plus a sidebar navigation /inbox → list. |
| `code-wi-sample2.mjs` | One sample: hard loads of list and table, a peek open on the list, and the /inbox → list navigation. |
| `code-inline-edit.mjs` | Own-write latency: pick another priority in a list row; time to the row showing it and the long tasks until the list settles. Writes to the database. |
| `code-ab-prod.sh`, `code-ab-prod2.sh` | Interleaved production A/B of two built copies on one database, one server start per sample. Writes `{round, variant, load, sample}` jsonl. `prod2` takes `PROJECT` and `DB` from the environment. |
| `code-ab-variants.sh`, `code-set-variant.sh` | Interleaved A/B/C/D on one dev server: `code-set-variant.sh` copies a variant's files into the experiment copy and HMR picks them up. |
| `code-ab-median.mjs` | Median, min and max per variant of an A/B jsonl, with the load per sample. |
| `code-nav-profile.mjs` | CPU profile of one client navigation, self time by function and by script. This is where `checkTruncation` and `readPortalWritingContext` showed up (docs/drafts/astryx-upstream-2026-10-24.md). |
| `code-load-profile.mjs` | CPU profile of one hard load until the ready selector shows. |
| `code-dom-controls.mjs` | DOM nodes inside closed popovers of the list, by kind (selector listbox, date calendar, tooltip, menu). |
| `code-date-open-check.mjs` | Functional check that a row's date chip still opens its picker. |
| `code-peek-remount.mjs` | Whether opening the peek remounts the list or only re-renders it; skeleton flash and RSC bytes of the push. |
| `code-route-js.mjs` | First-load JS per route from a production build's client-reference manifests, and which heavy libraries sit in it. |
| `code-nav-has.mjs` | Navigation /inbox → list with Tessera's `:has()` rules deleted through CSSOM or kept: does `:has()` amplify forced layouts? |
| `code-dev-bg-cpu.mjs` | Background CPU of the `next dev` process tree per client navigation, and how many static-paths workers it forks. |

Integration and review fixes (2026-10-28; ports 3812 to 3817 and the paths of that run are hard-coded):

| Script | What it measures |
|---|---|
| `integ2-sample.mjs` | One sample on a production server: hard loads of list (+ peek open), table and board, with DOM nodes and calendar day cells (`gridcell`), plus the /inbox → list navigation. The integrated round's main probe. |
| `fix-gantt-sample.mjs` | One sample: hard load of the work-item gantt (ready = first visible `.tessera-gantt-row`, hydrated = it carries a React fiber), DOM nodes, day cells, rows, mounted date fields and tooltips, then click to a row's Set-dates popover showing both fields. |
| `fix-ab.sh` | Interleaved production A/B of two built copies with any one-line sample script, one server start per sample, a fresh migrated copy of the 10k set per arm. Writes `{round, variant, load, sample}` jsonl. |
| `fix-tooltip-visual.mjs` | Screenshots of list, table and gantt around a long title (1440 and 480, Frappé and Latte) for a pixel diff, and the overflow tooltip of the cut title in each layout (hover, Escape, leave, a title that fits). |
| `fix-tooltip-rect.mjs` | The settled box of the list title's overflow tooltip 1.2 s after a hover, to compare two builds. |
| `lane-rows-pixdiff.mjs` | Pixel diff of same-named screenshots in two folders (a pixel differs when a channel differs by more than 24), with the bounding box of the change. Needs `sharp`. |

Dev server:

| Script | What it measures |
|---|---|
| `dev-common.mjs` | Shared helpers: route lists of both sets, dev-log parsing, stats, load averages. |
| `dev-init.mjs` | In-page instrumentation for the dev probes (long tasks, FCP, LCP, ready, and the click timer). |
| `dev-server.sh` | Starts or stops `next dev` or `next start` from a copy (optionally cold) and times "Ready". |
| `dev-firstvisits.mjs` | Full loads of every route in user order, each paired with the dev-log line of its document request: compile and render cost per first visit. |
| `dev-ab-coldwarm.sh` | Cycles of cold start, first visits, then a warm restart and first visits again. |
| `dev-nav.mjs` | The six-click sidebar navigation against one or more servers, interleaved, with RSC timing, long tasks, prefetches and the dev-log line per step. |
| `dev-hmr.mjs` | Fast Refresh: appends a comment to a component in the copy n times and times rebuild and done, and whether the page reloaded fully. |

Engine reads (rename to `.ts`, then run from a copy's root with `npx tsx --tsconfig tsconfig.json <file> <db> <out.json>`; they open the database read-only):

| Script | What it measures |
|---|---|
| `home-bench.ts.txt` | The engine reads Home makes, timed on a given database. |
| `shell-reads-bench.ts.txt` | The engine reads one request of the shell layout, the project layout, the work-items page and Home make. |

## Baseline (HEAD `d26461b`)

All are medians (n=5 per arm unless noted), and each file lists the 1-minute load of every sample. The 1-minute load during these runs was between 3.4 and 31.6.

| File | What | Key numbers (ms) |
|---|---|---|
| `code-ab-prod-large-medians.json` | Production, 10k set, CPU 1x: `head` versus `fix` (lazy date content + no row `maxLines`) | list ready 7,094 → 1,120; table 16,490 → 5,514; /inbox → list 7,015 → 970; peek 2,061 → 959; DOM 113,463 → 54,771 nodes |
| `code-ab-prod-small-medians.json` | Production, small set, CPU 1x | list 859 → 412; table 1,562 → 813 |
| `code-ab-prod-small-cpu4-medians.json` | Production, small set, CPU 4x | list hydrated 3,639 → 1,597; table hydrated 6,547 → 3,367 |
| `code-ab-variants-dev-large-medians.json` | Dev, 10k set: head, trunc, date, trunc+date | /inbox → list 11,033 / 4,110 / 8,898 / 2,082 |
| `code-inline-prod-large-medians.json` | Production, 10k set: inline priority edit | commit 1,107 → 456; settle 2,020 → 758 |
| `code-has-prod-large-medians.json` | Production, 10k set: `:has()` rules kept versus removed | /inbox → list 7,058 → 6,213 |
| `perf-spec.json` | Decision 115 spec on HEAD, n=20 after 2 warm-up rounds; load 4.2 → 15.8 | list p50 11,660 / p95 13,272; board 303 / 344; table 27,543 / 35,717 |
| `dev-metrics-compact.json` | Dev measurements (cold and warm start, first visits, navigation, HMR, JS weight), 123 rows | see each row's `notes` |
| `metrics.json` | Production measurements (server timing, hard loads, navigation, interactions, bundles), 373 rows | see each row's `notes` |

Later baselines (2026-10-28), in the same folder:

| File | What |
|---|---|
| `integ2-summary.json` | The integrated round: BEFORE `21f8ae3` against AFTER (lanes rows and guard), production and dev, 10k and small sets, with n and the load of every arm. The report's sections 1 and 2 are built from it. |
| `fix-gantt-prod-large-medians.json`, `fix-gantt-prod-large-cpu4-medians.json` | Review fix: the 10k work-item gantt before and after lazy Set-dates popovers and `OneLineText` labels (`fix-gantt-sample.mjs` through `fix-ab.sh`). |
| `fix-rows-prod-large-medians.json` | Review fix: list, peek, table, board and /inbox → list on 10k before and after `OneLineText` (the row title and table cells regain their overflow tooltip), to show the lanes' gains are kept. |

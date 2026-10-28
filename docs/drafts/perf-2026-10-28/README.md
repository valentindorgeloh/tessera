# Performance round 2026-10-28: probes and results

Kept here because the scratchpad gets wiped. The report that uses them is `docs/drafts/perf-report-2026-10-28.md`. None of this is product code: lint skips `docs/drafts/**`, and `bundle-compare.mts.txt` is TypeScript renamed so the type check (which includes `**/*.mts`) skips it.

Run the scripts only from scratch copies, against `next start` or `next dev` on your own ports and on copies of the fixture databases, with automations and webhooks off and no `ANTHROPIC_API_KEY`. Never use port 3000 or 3001, `data/tessera.db` or `data/dev/`. The shell scripts hard-code the scratchpad folder (`BC=` at the top) and the ports 3830 to 3835; change both first. The probes import `playwright` / `@playwright/test`: run them from a folder with a `node_modules` link to a checkout's `node_modules` (never copy that link). Database ids (project, item, cycle) are those of the seeded `p11-perf.db` and `small.db` files; a new seed gets new ids.

## Folders

| Path | What |
|---|---|
| `scripts/integ/` | the integrator's A/B harness and probes (table below) |
| `scripts/profile/` | the profile lane's probes ("what is left"): `run.mjs` harness (modes plain, react, cpu, trace), `init.mjs`/`common.mjs`, `serve.sh`, `campaign-*.sh`, `ab-rpwc.sh` (readPortalWritingContext counterfactual), `m12-html.mjs` and `m12-rsc.mjs` (HTML and RSC payload split), `census.mjs` and `ro-count.mjs` (closed popovers, ResizeObservers), `board.mjs` (decision 115 board loop), `analyze-cpu.mjs`, `sum-*.mjs`, `table.mjs`, `timeline*.mjs`, debug probes `dbg*.mjs` and `explore.mjs` |
| `baseline/integ/` | this round's raw A/B lines (`*.jsonl`, one JSON line per sample with variant A = BEFORE, B = AFTER and the load), the lane C probe outputs (`assets-*.json`, `peek-*.json`, `prefetch-[AB]-*.json`), `medians.json` (every median), the decision 115 spec logs and runs (`perf-spec-{before,after}{,-2}.*`), `bundle-before-after.json` (first-load gz per route), `bundle-baseline.lane-c-build.json` (lane C's original baseline), `chain.log` (timing and load per step), `devcounts/` (dev component counts) and `gate/` (check, e2e, check:bundle, build logs) |
| `baseline/profile/` | the profile lane's summaries: `profile-plain2-prod-*.json` (headline campaign), `profile-*-summary.json`, `profile-ab-rpwc-summary.log`, `profile-m12-*.json`, `profile-census.json`, `profile-resizeobserver-census.json`, `profile-board-large-d-plain.json` |
| `baseline/lane-b/`, `baseline/lane-c/` | the two lanes' own A/B results against BASE, as they reported them |

## scripts/integ

| Script | What it does | Writes to the DB |
|---|---|---|
| `chain.sh` | runs the whole campaign step by step and logs the load per step | — |
| `ab.sh` | interleaved production A/B: one fresh `next start` and one fresh DB copy per sample, optional warm-up run; `ab.sh <sample.mjs> <rounds> <out.jsonl> <large\|small\|grouped>` | per sample copy |
| `pair.sh` | starts BEFORE and AFTER side by side on fresh copies and runs a probe that interleaves itself (`ab-assets.mjs`, `ab-peek.mjs`, `prefetch-probe.mjs`) | — |
| `ab-dev.sh` | interleaved dev A/B with cold `next dev` per side (`code-wi-sample.mjs`) | — |
| `dev-counts.sh` | deterministic dev component counts on SMALL, n=1 per side (`devcount.mjs`, `loadcommits.mjs`, `refresh-dev.mjs`) | yes (fresh copy per probe) |
| `perf-spec.sh` | decision 115 spec (`playwright.perf.config.ts`) on one copy, port 3831 | fresh copy |
| `integ-sample.mjs` | list (+ peek), table, board hard loads and sidebar /inbox → list; `RATE=4` for CPU 4x | — |
| `select-sample.mjs` | traced row checkbox select / deselect / select again / second row | — |
| `inter-sample.mjs` | select, deselect, peek open / close, state open / pick with component counts | yes |
| `refresh-sample.mjs` | MCP agent write with the list visible, navigate away, write while hidden, navigate back (stale check) | yes |
| `has-sample.mjs` | grouped list (250 rows) /inbox → list | — |
| `prio-sample.mjs` | inline priority edit (from perf-run `code-inline-edit.mjs`) | yes |
| `ab-assets.mjs` | per-route script / task / long-task time at 375 px, CPU 1x or 4x | — |
| `ab-peek.mjs` | first peek 2 s or 300 ms after load, scripts fetched after the press | — |
| `prefetch-probe.mjs` | sidebar prefetch and skeleton timing (`ANALYTICS_HREF` picks the link) | — |
| `devcount.mjs`, `loadcommits.mjs`, `refresh-dev.mjs`, `why.mjs`, `navback-hist.mjs`, `devload.mjs` | dev component histograms (React DevTools hook in `lib.mjs`) | `devcount`, `refresh-dev`: yes |
| `summarize.mjs` | builds `medians.json` from a results folder | — |
| `sum.mjs` | quick medians of one `.jsonl` | — |
| `bundle-compare.mts.txt` | first-load gz per route of two builds, with AFTER's `scripts/check-bundle.ts` helpers (rename to `.mts`, run with `npx tsx`) | — |
| `code-wi-sample.mjs`, `dev-nav.mjs`, `dev-common.mjs`, `dev-init.mjs`, `perf-init.mjs`, `lib.mjs`, `grouped-display.json` | helpers copied from `docs/drafts/perf-2026-10-24/` | — |

## Headline medians (BEFORE → AFTER, production unless marked)

| Metric | n | Load | BEFORE | AFTER |
|---|---|---|---|---|
| Tick a row checkbox, 10k (ms / longest task) | 5+5 | 0.9–1.5 | 265 / 219 | 94 / 0 |
| Pick a state from a row, 10k | 5+5 | 0.9–1.5 | 237 | 58 |
| Agent write, list visible, 10k (components) | 5+5 | 0.7–1.9 | 40,720 | 2,787 |
| Open the list / table, 10k | 5+5 | 1.6–3.0 | 927 / 1,552 | 793 / 1,403 |
| Peek open, 10k / small | 5+5 | 1.6–3.0 | 697 / 250 | 472 / 186 |
| First-load gz, work-items (KB) | build | — | 960.1 | 669.3 |
| Analytics skeleton (ms) | 5+5 | 0.9–1.7 | 94 | 56 |
| dev /inbox → list, 10k | 5+5 | 2.8–4.2 | 1,827 | 1,505 |
| Decision 115 spec p95 list / table (two runs each) | 20 | 2.2–3.5 | 949, 972 / 1,838, 1,889 | 902, 915 / 1,653, 1,643 |

## review-fixes/

The review-fix pass (report section 9). `scripts/`: `has-recalc.mjs` (in-page A/B of the scroller rule on the grouped list, style recalc and layout from CDP), `has-nav.mjs` (the same swap on the ungrouped /inbox to list navigation), `sweep.sh` + `rows-check.mjs` + `sum-sweep.mjs` (page-size sweep with the decision 115 spec, port 3838, needs the `sweep-copy.patch` changes in a scratch copy), `refresh-known.mjs` + `known2.sh` (first agent write by a known and a new actor), `ab-fix.sh` + `sum-ab.mjs` (the interleaved A/B between two trees), `sum-has.mjs`. Hard-coded paths and ports (3838 / 3839) as in the other scripts. Results: `fixer-sweep.jsonl`, `fixer-has-recalc-1.json`, `fixer-has-nav.jsonl`, `fixer-ab-integ-final.jsonl` (pre-fix against fixed tree) and the `*-reverted-build` files (the A/B of the build in which the scroller class was reverted), `fixer-first-write-{known,new}-actor.jsonl`.

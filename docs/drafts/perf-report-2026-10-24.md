# Tessera performance report (round of 2026-10-24, integrated 2026-10-28)

Status: integrated, verified, reviewed and fixed. BEFORE is git `21f8ae3` (HEAD after fix round 6). AFTER is `21f8ae3` plus the two lanes of this round, "rows" and "guard", plus the review fixes of 2026-10-28 (section 2.9). The Measure phase ran on `d26461b`; its numbers are in section 3 and Appendix A.

The review found three things, all fixed in section 2.9: the work-item gantt (and the modules timeline) still had both slow patterns the round removed from the list; cut row titles and cut table Name and Project cells had lost their hover tooltip; and this report was not yet in the repo. Sections 2.2 to 2.8 measure AFTER as it was before those fixes. Section 2.9 measures the fixes against it. The gate in section 2.1 ran on the fixed AFTER.

Short paths:
- `PERF` = `/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf`. The scratchpad gets wiped. Section 7 says what to keep.
- `BASELINE` = `docs/drafts/perf-2026-10-24/perf-run/baseline/` (lands with this round; it holds the Measure-phase medians).

Every wall-clock number comes from a shared machine, so each table gives n and the 1-minute load average. All before/after numbers are medians of interleaved runs (BEFORE, AFTER, BEFORE, AFTER ...). DOM node counts do not depend on load, so they are the firmest evidence.

---

## 1. In plain words

### What was slow, and why

1. **The dev server is slow by design.** `next dev` never prefetches: "Automatic prefetching runs only in production" (`node_modules/next/dist/docs/01-app/02-guides/prefetching.md:64`). It "compiles routes in your application as you open or navigate to them" (`01-app/02-guides/local-development.md:13`). It runs React Strict Mode, which is on by default in the app router and is a development-only feature (`01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md:8`, `:12`), so everything renders twice. It also ships 12 to 17 MB of JavaScript per page, against about 3 MB in production. Section 4 says what to run instead.
2. **The work-item list and table were slow to draw in the browser.** The server answers in 10 to 25 ms and SQLite in 1 to 5 ms. The time went into building rows on the client, for two reasons, both in our row code:
   - **A hidden calendar behind every date chip.** Each Start and Target chip kept a full month calendar mounted inside its closed popup, because Astryx 0.6.8 `Popover` has no lazy option. With both dates shown that is two calendars per row. On the 200-row page of the 10 000-item project, the 400 calendars held 61,892 of the page's 113,463 DOM nodes, including 16,800 day cells.
   - **A measurement for every label.** Each row title, state, priority, assignee and group label used Astryx `Text maxLines={1}`. That measures every Text when it mounts, which forces a browser layout each time, even with the tooltip off. On the 10k page that is 2,402 measured Texts. In the dev profile of a click to the list, the measuring (`checkTruncation`) took 6.7 s of 9.9 s.
   - **The gantt had both too** (found in review). Each of its 200 rows kept two closed calendars inside its Set-dates popover (16,800 day cells, 68,133 DOM nodes on the 10k gantt) and measured three `maxLines` Texts on mount. Fixed in section 2.9.
3. **Not fixed in this round (later lanes):**
   - Every click inside the list still redraws the whole list (decision 141, lane B).
   - List pages still ship the editor up front (decision 142, lane C).
   - Closed selector and tooltip layers are still mounted (an Astryx upstream issue; see section 6).

### What changed

- **Lane rows (the fix).**
  - The date chip now mounts its calendar only while its popup is open (`DateControl.tsx`).
  - Row titles and the state, priority, assignee and group labels are cut to one line by a plain CSS ellipsis (`.tessera-wi-title`, `.tessera-wi-label-text` in `work-items.css`) instead of Astryx's measuring `maxLines`. The table's Name and Project cells drop `maxLines`, because the Astryx Table already cuts them (the review fix makes them `OneLineText` with their own one-line class, section 2.9).
  - The look does not change: 92 of 104 screenshot pairs are pixel-identical, and the rest differ only in relative timestamps and ellipsis anti-aliasing. The review's check found one exception the lane's fixture missed, a cut table Name cell shifted about 8 px left; the review fix removes it, and the fixed AFTER is pixel-identical to HEAD in all 12 list, table and gantt shots of section 2.9.
  - A cut title, and a cut Name or Project cell in the table, still shows in full in a tooltip when you rest the mouse on it (restored by the review fix, section 2.9).
  - Two new Vitests guard both changes. ui.md and the as-built doc say why.
- **Lane guard (safety net).**
  - A Vitest tripwire ties the tolerated Astryx `moveTo`/`start`/`cancel` console warning to the installed Astryx bug, so the tolerance must go when an upgrade fixes it.
  - The decision 115 perf spec (`tests/e2e/perf.spec.ts`, `playwright.perf.config.ts`) is landed. It is opt-in, so the normal suite reports 1 skipped.
  - The probes and baseline medians are archived in `docs/drafts/perf-2026-10-24/perf-run/`.
  - An Astryx upstream issue and PR are drafted, not filed (`docs/drafts/astryx-upstream-2026-10-24.md`).
- **Review fixes (2026-10-28, section 2.9).**
  - The work-item gantt and the modules timeline get the same two fixes: a row's Set-dates popover mounts its two date fields only while open, and the band labels, row names and bar labels are cut by CSS. On the 10k gantt the page drops from 68,133 to 8,037 DOM nodes and is ready to use in 0.68 s instead of 1.53 s.
  - The tooltip on cut titles and table cells is back without the mount cost: a small `OneLineText` component measures only the text under the mouse, after the usual 200 ms tooltip delay.
  - This report and the run's medians are now in the repo (section 7).
- **Freshness is unchanged.**
  - No change to ChangesPoller, `refresh()` or the server actions.
  - In the inline-edit probe your own write shows in 430 ms. The server action goes out at about 390 ms, and the changes poll still runs at about 0.7 s and 4.7 s after the pick.
  - The e2e spec for external MCP writes reaching an open tab (`external-writes.spec.ts`) passes.

### Before and after (this run: production unless marked dev)

| What you do | Target | Measure phase, `d26461b` | BEFORE `21f8ae3` | AFTER | n, 1-min load | Met |
|---|---|---:|---:|---:|---|---|
| Open the work-item list, 10k items (hard load to `[data-list-ready]`) | ≤ 1,300 ms | 7,094 | 6,221 | **962** | 5+5, 2.1–5.4 | yes |
| Sidebar click /inbox → list, 10k | ≤ 1,200 | 7,015 | 6,372 | **971** | 5+5, 2.1–5.4 | yes |
| Open a row in the peek, 10k | ≤ 1,100 | 2,061 | 1,493 | **703** | 5+5, 2.1–5.4 | yes |
| Open the table, 10k | ≤ 4,000 | 16,490 | 14,485 | **1,630** | 5+5, 2.1–5.4 | yes |
| DOM nodes of the 10k list page | ≤ 56,000 | 113,463 | 111,757 | **53,065** | 5+5 | yes |
| Calendar day cells (`gridcell`) on the list | 0 | 16,800 | 16,800 | **0** | 5+5 | yes |
| Open the board, 10k | within +5% of BEFORE | 2,043 (lane run) | 1,654 | **1,623** (−1.9%) | 5+5, 2.1–5.4 | yes |
| Change a row's priority inline, 10k: commit | ≤ 550 | 1,107 | 1,086 | **430** | 5+5, 7.1–8.4 | yes |
| Same: list settled again | — | 2,020 | 2,140 | **636** | 5+5, 7.1–8.4 | — |
| Open the list, about 50 items | ≤ 480 | 859 | 791 | **373** | 5+5, 4.2–6.6 | yes |
| Sidebar click /inbox → list, about 50 items | ≤ 620 | 1,002 | 1,009 | **591** | 5+5, 4.2–6.6 | yes |
| Open the table, about 50 items | ≤ 700 | 1,562 | 1,406 | **566** | 5+5, 4.2–6.6 | yes |
| Peek, about 50 items | ≤ 300 | 431 | 405 | **255** | 5+5, 4.2–6.6 | yes |
| DOM nodes, about 50 items | ≤ 14,000 | 27,331 | 27,331 | **13,138** | 5+5 | yes |
| List, about 50 items, slow CPU (4x) | ≤ 1,800 | 3,639 | 3,151 | **1,380** | 5+5, 4.9–11.3 | yes |
| /inbox → list, slow CPU | ≤ 1,300 | 3,140 | 2,666 | **997** | 5+5, 4.9–11.3 | yes |
| Table, slow CPU | ≤ 3,000 | 6,547 | 5,779 | **2,167** | 5+5, 4.9–11.3 | yes |
| Sidebar Projects → Work items, about 50 items | — | 928 | 870 | **473** | 5+5, 6.5–11.2 | — |
| Same, slow CPU | — | — | 2,604 | **914** | 5+5, 6.8–7.9 | — |
| Open the gantt, 10k (hard load until its first row responds) | — | — | 1,531 ¹ | **679** | 6+6, 7.7–12.1 | — |
| DOM nodes of the 10k gantt | — | — | 68,133 ¹ | **8,037** | 6+6 | — |
| Calendar day cells on the gantt | — | — | 16,800 ¹ | **0** | 6+6 | — |
| Gantt, 10k, slow CPU (4x) | — | — | 4,953 ¹ | **1,500** | 5+5, 6.6–16.1 | — |
| **dev** /inbox → list, 10k | ≤ 2,400 | 11,033 | 9,661 | **1,914** | 5+5, 2.2–2.9 | yes |
| **dev** open the list, 10k | ≤ 3,000 | 10,319 | 8,846 | **2,277** | 5+5, 2.2–2.9 | yes |
| **dev** Projects → Work items, about 50 items | ≤ 900 | 1,338 | 1,283 | **575** | 5+5, 1.8–9.6 | yes |
| **dev** profile of the /inbox → list click: `checkTruncation` self time, 10k | ≤ 100 | 6,739 | 6,184 / 6,133 | **94 / 88** | 2+2, 6.8–7.9 | yes |
| **dev** profile of the table load: `checkTruncation` self time, 10k | ≤ 100 | 13,109 (lane HEAD) | 12,744 / 12,718 | **119 / 115** | 2+2, 6.8–7.9 | **no**, by 15–19 ms |

¹ The gantt rows come from the review round (section 2.9): BEFORE there is AFTER as it was before the review fixes, whose gantt code is `21f8ae3`'s (the lanes did not touch it). The gantt has no `[data-list-ready]`, so it counts until its first row carries React's handlers.

Times are in ms. "Open" is a hard page load to the list's `[data-list-ready]` marker. On the about-50-items set the list and table numbers are the hydrated times, because the server-rendered list sometimes paints before hydration. "10k" is the decision 115 fixture (`scripts/perf-seed.ts`, 10 000 items). "About 50 items" is the small fixture. BEFORE is a little faster than the Measure phase on `d26461b`, mostly because this run's load was lower (2 to 11 against 5 to 31). The 10k page also has about 1,700 fewer DOM nodes at `21f8ae3` (111,757 against 113,463), while the small page is unchanged (27,331). I did not trace that difference.

**What this means for you:**
- On about 50 items, the list opens in about 0.37 s instead of 0.79 s, the table in 0.57 s instead of 1.4 s, and the sidebar click to the list takes 0.47 s instead of 0.87 s.
- On 10 000 items, the list is 6.5 times faster and the table 9 times faster. The page holds half as many DOM nodes.
- On 10 000 items, the gantt responds in 0.68 s instead of 1.53 s (1.5 s instead of 5.0 s on a slow CPU) and holds 8,037 DOM nodes instead of 68,133.
- A cut title or table cell shows its full text in a tooltip when you rest the mouse on it, as before this round.
- In dev, the same clicks are 2.2 to 5 times faster. Dev is still slower than production (section 4).

The decision 115 budget (300 ms at p95 on 10k items) is still missed for list and table: the perf spec measures list p95 1.1 s and table p95 2.0 s (section 2.6).

---

## 2. This run in detail

### 2.1 Gate on AFTER

| Step | Result |
|---|---|
| Lane files | Every code and test file in AFTER equals its lane copy (`cmp`). `docs/contracts/ui.md` and `docs/as-built/hardening.md` equal a fresh `git merge-file` of HEAD, `d26461b` and the lane copy (no conflicts). `diff -r` BEFORE against AFTER lists exactly the lanes' files. |
| `npm run check` | Green: tsc, eslint, Vitest 244 files / 3,031 tests, conventions, licences (632 packages, 7 reviewed exceptions), theme with only the documented `theme-fonts` warning. |
| `next build` | Exit 0 on the first try. No SecurityFatalError, so no retry was needed. |
| `npm run check:bundle` | Passed: 123 files in `.next/static`, none with a forbidden string. |
| e2e, whole suite, `E2E_PORT=3812` | **138 passed, 1 skipped** (the opt-in perf spec), 10.4 min, load 9.8 at the start and 4.0 at the end. No failures and no flakes, so nothing needed a re-run. `--list`: BEFORE 138 tests in 24 files, AFTER 139 in 25. `perf.spec.ts` is the only addition. `tests/e2e/tolerated.ts` is unchanged, so there is no new console tolerance. |
| Tripwire | On installed Astryx 0.6.8: 6/6 green. In a clone whose `dist/ContextMenu/ContextMenu.js:525` picks the four touch handlers by name (the upstream PR's shape), 2 of 6 fail: the tolerance test and the 0.6.8 bug test. That is red, as intended. Restored: 6/6 again (`PERF/results/integ2-tripwire-flip.txt`). |
| Decision 115 perf spec, AFTER, 10k, `PERF_PORT=3813` | Runs and writes `results.json` and `perf-runs.json`. It fails its own 300 ms budget, as expected (section 2.6). |

**Gate re-run on AFTER with the review fixes (section 2.9), 2026-10-28:**

| Step | Result |
|---|---|
| `npm run check` | Green: tsc, eslint, Vitest **246 files / 3,044 tests** (+2 files, +13 tests: `one-line-text`, `gantt-dates-lazy`, and `row-truncation` now also covering the gantt files), conventions, licences (632 packages, 7 reviewed exceptions), theme with only the documented `theme-fonts` warning. |
| `next build` (`TESSERA_DB_PATH=data/build.db`) | Exit 0 on the first try both times it ran (before the A/B and after `npm run check`). No SecurityFatalError. |
| `npm run check:bundle` | Passed: 124 files in `.next/static`, none with a forbidden string. |
| e2e, affected specs, `E2E_PORT=3812` | `coverage-timeline`, `layouts`, `drag`, `round-features`, `round4`, `coverage-drops`, `collaboration`, `coverage-dialogs`: **54 passed**, 4.5 min, load 8.5 → 6.9. |
| e2e, whole suite, `E2E_PORT=3812` | **138 passed, 1 skipped** (the opt-in perf spec), 10.2 min, load 6.4 → 2.4. No failures and no flakes (retries are 0), so nothing was re-run. |
| Decision 115 perf spec | Not re-run: the interleaved list, table and board A/B in section 2.9 shows no change from the fixes. |

### 2.2 Production, 10k items (`integ2-ab-prod-large`)

The browser is Chromium at 1440x900, with a new context per load. Each sample starts its own `next start`, followed by one warm-up. n=5 per arm, interleaved. Load before: 2.9, 2.8, 2.1, 3.6, 3.6. Load after: 3.3, 2.7, 3.4, 3.3, 5.4.

| Metric (ms or count) | BEFORE median (min–max) | AFTER median (min–max) |
|---|---:|---:|
| list ready | 6,221 (6,123–6,310) | 962 (953–972) |
| list long tasks | 6,533 | 787 |
| list longest task | 5,919 | 636 |
| list DOM nodes | 111,757 | 53,065 |
| list `gridcell`s | 16,800 | 0 |
| peek, click to title | 1,493 (1,412–1,658) | 703 (689–715) |
| table ready | 14,485 (14,292–14,664) | 1,630 (1,614–1,639) |
| table long tasks | 14,804 | 1,398 |
| table DOM nodes | 115,106 | 56,030 |
| board ready | 1,654 (1,620–1,662) | 1,623 (1,618–1,637) |
| /inbox → list, URL change | 84 | 84 |
| /inbox → list, ready | 6,372 (6,174–6,382) | 971 (933–992) |
| FCP of the list | 192 | 160 |

### 2.3 Production, inline priority edit, 10k (`integ2-ab-prod-large-inline`)

n=5 per arm, rows 4 to 8. Load before: 7.1, 7.3, 8.4, 7.5, 7.6. Load after: 7.2, 7.6, 8.0, 7.9, 7.2.

| Metric | BEFORE | AFTER |
|---|---:|---:|
| open the priority list | 151 | 128 |
| pick to row showing the new priority (commit) | 1,086 | 430 |
| pick to list settled | 2,140 | 636 |
| long tasks after the pick | 973 | 304 |
| requests in the 6 s after the pick (sample 1) | changes@74, action@994, changes@4079 | action@385, changes@670, changes@4674 |

### 2.4 Production, about 50 items (`integ2-ab-prod-small`, `-small-cpu4`)

n=5 per arm. CPU 1x load: before 4.2–5.0, after 4.4–6.6. CPU 4x load: before 4.9–10.8, after 5.9–11.3.

| Metric | BEFORE 1x | AFTER 1x | BEFORE 4x | AFTER 4x |
|---|---:|---:|---:|---:|
| list ready | 781 | 373 | 501 | 499 |
| list hydrated | 791 | 373 | 3,151 | 1,380 |
| list long tasks | 793 | 216 | 3,518 | 1,281 |
| list DOM nodes | 27,331 | 13,138 | 27,329 | 13,138 |
| list `gridcell`s | 4,032 | 0 | 4,032 | 0 |
| peek | 405 | 255 | 1,479 | 847 |
| table hydrated | 1,407 | 566 | 5,779 | 2,167 |
| table DOM nodes | 29,827 | 15,618 | 29,825 | 15,618 |
| board hydrated | 357 | 352 | 1,358 | 1,359 |
| /inbox → list ready | 1,009 | 591 | 2,666 | 997 |

At 4x the server-rendered list and table paint early (ready about 0.5 s in both arms). What the lane changes is the time until they respond (hydrated).

### 2.5 Navigation sequence at 1440 (production, `dev-nav.mjs`)

Home → Projects → Work items → Cycles → Inbox → Analytics → Home, as sidebar and tab clicks. Each step is timed from click to ready. Both servers stay up for the whole run, with 1 warm-up round, then 5 interleaved rounds. No console errors or warnings appeared in any round. Production prefetched 45 routes per round in both arms.

| Step | small 1x BEFORE | small 1x AFTER | small 4x BEFORE | small 4x AFTER | 10k 1x BEFORE | 10k 1x AFTER |
|---|---:|---:|---:|---:|---:|---:|
| Home → Projects | 67 | 66 | 119 | 122 | 66 | 65 |
| Projects → Work items | 870 | **473** | 2,604 | **914** | 6,129 | **853** |
| Work items → Cycles | 394 | 397 | 346 | 309 | 176 | 395 |
| Cycles → Inbox | 70 | 72 | 191 | 162 | 78 | 73 |
| Inbox → Analytics | 438 | 437 | 368 | 339 | 530 | 495 |
| Analytics → Home | 67 | 52 | 163 | 136 | 217 | 117 |
| 1-min load (range) | 6.7–11.2 | 6.5–9.8 | 7.1–7.9 | 6.8–7.8 | 7.4–8.2 | 6.9–8.5 |

The 10k "Work items → Cycles" step is bimodal in both arms, at about 170 ms or about 400 ms. That is the 300 ms Suspense reveal throttle seen in the Measure phase. BEFORE had 3 of 5 fast runs and AFTER had 2 of 5, so its median flips with the sample.

### 2.6 Decision 115 perf spec (10k, warm cache in one tab, grouped by state)

| Run | n | list p50 / p95 | board p50 / p95 (runs over 1 s) | table p50 / p95 | took | load |
|---|---|---:|---:|---:|---|---|
| AFTER | 20 (+2 warm-up) | 970 / **1,121** | 1,028 / 1,204 (11 of 20) | 1,907 / **1,996** | 144 s | 3.5 → 2.8 |
| AFTER | 10 (+1) | 905 / 934 | 1,015 / 1,180 (8 of 10) | 1,812 / 1,862 | 70 s | 7.9 → 7.7 |
| BEFORE (HEAD build plus the two spec files, `PERF/integ2-before-spec`) | 10 (+1) | 16,028 / 19,202 | 1,197 / 1,345 (6 of 10) | 38,900 / 57,185 | 678 s | 10.3 → 3.9 |
| AFTER | 10 (+1) | 912 / 1,005 | 1,011 / 1,046 (7 of 10) | 1,836 / 1,885 | 70 s | 3.9 → 3.3 |
| `d26461b` baseline (BASELINE/perf-spec.json) | 20 (+2) | 11,660 / 13,272 | 303 / 344 (1 of 20) | 27,543 / 35,717 | 1,011 s | 4.2 → 15.8 |

- **Against the root's expectations for the n=20 rerun:**
  - List p95 1.12 s (expected 1.1 to 1.5 s): met.
  - Table p95 2.0 s (expected 3 to 4 s): better than expected.
  - Board ≤ 344 ms: **not met**. The board reveal is bimodal: its marker is either visible at about 0.25 to 0.3 s or only after the page's 1.0 to 1.3 s of start-up long tasks. BEFORE shows it too (6 of 10 slow), and the guard lane saw 16 of 30 on both of its arms. The lanes do not cause it, and AFTER's slow mode is faster (1.0 to 1.2 s against 1.2 to 1.35 s). The cold-load board probe in 2.2 shows no change (1,654 → 1,623).
- **BEFORE gets slower run after run in one tab:** list 10.4 → 19.2 s, table 27.5 → 57.2 s, while the load fell from 10 to 4. The `d26461b` baseline drifted the same way, less steeply. AFTER drifts by about 10% at most. The 113k-node pages are the likely cause (memory pressure in the tab), but I did not profile it.

### 2.7 Dev, 10k and about 50 items (`integ2-ab-dev-large`, `integ2-ab-dev-small`)

Each arm has its own cold-started `next dev` (`rm -rf .next/dev`). Every route was compiled once and one warm-up sample ran before n=5 interleaved samples. 10k load: before 2.2–2.9, after 2.3–2.6. About-50-items load: before 1.8–9.6, after 2.1–8.3.

| Metric | 10k BEFORE | 10k AFTER | small BEFORE | small AFTER |
|---|---:|---:|---:|---:|
| list hard load, ready | 8,846 | 2,277 | 1,540 | 781 |
| list hard load, hydrated | 8,847 | 2,279 | 1,579 | 794 |
| list long tasks | 8,466 | 1,988 | 1,633 | 493 |
| list DOM nodes | 111,758 | 53,064 | 27,332 | 13,137 |
| /inbox → list, ready | 9,661 | 1,914 | 1,373 | 614 |
| dev-nav Projects → Work items | — | — | 1,283 | 575 |
| dev-nav Home → Projects / Work items → Cycles / Cycles → Inbox / Inbox → Analytics / Analytics → Home | — | — | 151 / 254 / 192 / 599 / 174 | 151 / 234 / 187 / 597 / 165 |

### 2.8 Dev CPU profiles, 10k (`integ2-*-profile-dev-large-*`)

Self time by function, sampling every 200 µs. Order: after, before, after, before. Load 6.8 to 7.9.

| Profile | BEFORE ready | AFTER ready | `checkTruncation` BEFORE | `checkTruncation` AFTER | Astryx `plainDateFormat` BEFORE → AFTER | `readPortalWritingContext` AFTER |
|---|---:|---:|---:|---:|---:|---:|
| /inbox → list click | 10,171 / 10,073 | 1,976 / 1,977 | 6,184 / 6,133 | **94 / 88** | 861 / 851 → not in top 30 | 308 / 306 |
| table hard load | 18,587 / 18,623 | 3,657 / 3,620 | 12,744 / 12,718 | **119 / 115** | 1,696 / 1,691 → not in top 25 | 294 / 316 |

- **The table-load remainder (115 to 119 ms against the ≤ 100 target)** comes from the two page-chrome Texts that still use `maxLines`: the ProjectFrame heading and the "Work items" Text in WorkItemsScreen. They lie outside lane rows' files, and the first one forces the initial layout of the new 56k-node table, which the browser does before paint anyway.
- **What is left after this round:** `readPortalWritingContext` (Astryx Layer, about 0.3 s per dev profile) is now the largest single function. It is the closed selector and tooltip layers: 588 closed listboxes (29,324 nodes) and 686 tooltips on the 10k page. That is the upstream lazy-mount issue in section 6.

### 2.9 Review fixes (2026-10-28)

The review of the integrated round found three problems. This section is the fix and its numbers.

**What was fixed:**

- **The gantt still had both slow patterns.** `GanttDates` (one Set-dates popover per draggable row, 200 rows on an ungrouped page) kept its two full `DateInput`s mounted while closed, and every row measured two `maxLines` Texts (name and bar label) on mount, plus one per band label. `ModuleDates` in the modules timeline had the same popover. Now:
  - both popovers pass `content={isOpen ? … : null}`, like the date chip (`GanttLayout.tsx`, `planning/ModulesTimeline.tsx`);
  - the band labels, row names and bar labels are cut by a one-line rule in `gantt.css` (the four declarations of Astryx's singleLine style, placed before the container query that hides a short bar's label);
  - `tests/ui/gantt-dates-lazy.test.ts` checks that both popovers mount their pickers only while open (it fails on the old code), and `row-truncation.test.ts` now covers `GanttLayout.tsx` and `ModulesTimeline.tsx`.
- **Cut row titles and table cells had lost their tooltip** (Plane shows one: `docs/drafts/plane-visual-reference.md`, row "Title"). Option A of the review: a new `OneLineText` (`src/components/work-items/OneLineText.tsx`, 76 lines) renders the Text with the caller's CSS one-line class and measures nothing on mount. Once the mouse has rested on it for 200 ms (Astryx's tooltip delay), it compares `scrollWidth` with `clientWidth` once and, only if the line is cut, renders an Astryx `Tooltip` in its documented sibling mode (`anchorRef`), controlled with `isOpen`. It closes on leave, on a press and on Escape, and does nothing for touch, like Astryx's own truncation tooltip on a Text that is not focusable. It is used for the list's `RowTitle`, the table's Name and Project cells (new class `tessera-wi-cell-text`, same four declarations) and the gantt and modules-timeline labels. `tests/ui/one-line-text.test.ts` checks no measuring on mount, the delay, cut against not cut, leave, press and touch.
- **The report was not in the repo.** It is now `docs/drafts/perf-report-2026-10-24.md`, with `integ2-summary.json` and this section's medians in `docs/drafts/perf-2026-10-24/perf-run/baseline/` and the probes in `perf-run/scripts/` (section 7). `docs/drafts/perf-2026-10-24/README.md` has its `perf-run/` row.

**Gantt, production, 10k items** (`fix-gantt-sample.mjs` through `fix-ab.sh`): BEFORE-FIX is `PERF/after2-pre` (AFTER with its build from before the fixes), AFTER is `PERF/after2` rebuilt. Chromium 1440x900, a new server per sample plus one warm-up load, interleaved before, after. Ungrouped gantt, month zoom, 200 rows.

| Metric (ms or count) | CPU 1x BEFORE-FIX | CPU 1x AFTER | CPU 4x BEFORE-FIX | CPU 4x AFTER |
|---|---:|---:|---:|---:|
| n per arm | 6 | 6 | 5 | 5 |
| 1-minute load | 7.8–12.1 | 7.7–11.7 | 7.0–16.1 | 6.6–15.0 |
| first row responds (hydrated) | 1,531 (1,528–1,539) | **679** (664–709) | 4,953 (4,721–5,108) | **1,500** (1,458–1,540) |
| first row visible | 482 | 578 | 906 | 1,458 |
| FCP | 426 | 428 | 504 | 480 |
| long tasks, total | 2,120 | **157** | 6,738 | **1,167** |
| longest task | 977 | 157 | 4,012 | 647 |
| DOM nodes | 68,133 | **8,037** | 68,129 | **8,037** |
| calendar day cells (`gridcell`) | 16,800 | **0** | 16,800 | **0** |
| mounted Set-dates panels | 200 | **0** | 200 | **0** |
| tooltip layers in the DOM | 396 | 23 | 396 | 23 |
| click Set dates → both fields shown | 110 | 86 | 246 | 163 |
| console errors | 0 | 0 | 0 | 0 |

- **"First row visible" is bimodal in both arms and is not a regression.** The server-rendered rows either paint at about 0.48 s (0.87 s at 4x) or only when the page hydrates; it is the same reveal race as the board's (section 2.6). BEFORE-FIX: 6 of 6 early at 1x, 3 of 5 at 4x. AFTER: 3 of 6 early at 1x (478–492, the others 664–667), 2 of 5 at 4x (868, 873, the others 1,458–1,539). The latest the first row shows is now 0.67 s instead of the 1.53 s it took BEFORE-FIX to respond (1.54 s against 4.95 s at 4x).
- The 373 tooltip layers that are gone were the truncation tooltips Astryx `Text maxLines` mounted for every cut gantt label; `OneLineText` mounts one only on hover.
- Opening a row's Set-dates popover mounts its two fields on demand and is still faster than before (86 against 110 ms), because the page around it is lighter.

**List, table and board are unchanged by `OneLineText`** (`integ2-sample.mjs` through `fix-ab.sh`, 10k, CPU 1x, n=5 per arm, interleaved; load before 2.6–20.8, after 1.8–15.4):

| Metric (ms or count) | BEFORE-FIX | AFTER |
|---|---:|---:|
| list ready | 960 | 955 |
| peek, click to title | 713 | 721 |
| table ready | 1,604 | 1,589 |
| board ready | 1,616 | 1,615 |
| /inbox → list ready | 980 | 946 |
| DOM nodes list / table / board | 53,065 / 56,030 / 13,057 | 53,065 / 56,030 / 13,057 |

The section 1 and 2.2 gains are kept: `OneLineText` adds no DOM node and no measurement until a hover.

**The tooltip and the look, checked in Chromium** (`fix-tooltip-visual.mjs`, `fix-tooltip-rect.mjs`, a copy of the small set with one 135-character title and one "Short" title):

| Layout at 1440 | HEAD `21f8ae3` (`Text maxLines`) | BEFORE-FIX (lanes) | AFTER (`OneLineText`) |
|---|---|---|---|
| list title | tooltip after 191 ms | **no tooltip** | tooltip after 213 ms |
| table Name cell | tooltip after 193 ms | **no tooltip** | tooltip after 214 ms |
| gantt name | tooltip after 224 ms | tooltip after 220 ms | tooltip after 214 ms |

- AFTER: Escape hides the tooltip, leaving hides it, and the "Short" title (not cut) opens none, in all three layouts. The settled list tooltip has the same box as HEAD's (x 557.9, y 542.5, 300 by 68).
- **Screenshots** (list, table and gantt around the long title, at 1440 and 480, Frappé and Latte; a pixel counts when a channel differs by more than 24): AFTER against HEAD `21f8ae3`, 12 of 12 identical, and so are the table and gantt tooltip shots (the list tooltip shot differs only by the frame of its fade-in). AFTER against BEFORE-FIX: list and gantt identical; the table differs in all 4 shots (1,201 to 1,211 pixels in one cell). That is a lane regression the fix removes: with the lanes, the cut Name cell of the longest title started about 8 px left of the other names in its column (a plain inline Text in the Table's truncating cell); `tessera-wi-cell-text` makes the Text the block that is cut again, as at HEAD.
- No console message beyond the tolerated CSS preload warnings.

---

## 3. Measure phase (d26461b, 2026-10-24)

These are the numbers that started the round. The full metric lists are in Appendix A. The raw medians are in BASELINE (`metrics.json`, `dev-metrics-compact.json`, `code-ab-*-medians.json`, `perf-spec.json`).

### 3.1 The quick-win A/B that became lane rows (production, n=5 each, `code-ab-prod-*-medians.json`)

| Metric | 10k HEAD | 10k fix | small HEAD | small fix | small 4x HEAD | small 4x fix |
|---|---:|---:|---:|---:|---:|---:|
| list ready (4x: hydrated) | 7,094 | 1,120 | 859 | 412 | 3,639 | 1,597 |
| list DOM nodes | 113,463 | 54,771 | 27,331 | 13,138 | 27,327 | 13,138 |
| peek | 2,061 | 959 | 431 | 255 | 1,763 | 948 |
| table ready (4x: hydrated) | 16,490 | 5,514 | 1,562 | 813 | 6,547 | 3,367 |
| /inbox → list ready | 7,015 | 970 | 1,002 | 542 | 3,140 | 1,117 |
| 1-min load | 9.2–17.7 | 7.7–14.7 | 6.9–9.5 | 7.0–10.3 | 4.1–7.6 | 3.4–6.3 |

Lane rows then also took `maxLines` off the table's Name and Project cells, which brought the 10k table from 5.5 s to about 1.6 to 2.1 s.

### 3.2 Inline priority edit, 10k (`code-inline-prod-large-medians.json`)

The commit fell from 1,107 to 456 ms and the settle from 2,020 to 758 ms (n=5, load 8.9–17.0).

### 3.3 Dev, 10k, by variant (`code-ab-variants-dev-large-medians.json`, n=5)

| Variant | list hard load ready | /inbox → list ready | DOM nodes | 1-min load |
|---|---:|---:|---:|---|
| HEAD | 10,319 | 11,033 | 113,464 | 9.8–20.7 |
| truncation only | 4,631 | 4,110 | 113,464 | 12.3–15.7 |
| date chip only | 8,058 | 8,898 | 54,770 | 10.3–26.5 |
| both (lane rows) | 2,525 | 2,082 | 54,770 | 8.4–31.6 |

### 3.4 Dev against production on the same code, 10k (`PERF/results/dev-large-devprod-summary.json`, n=5)

| Hard load | dev | prod |
|---|---:|---:|
| Home | 710 | 411 |
| work-item list | 8,846 | 6,456 |
| table | 19,753 | 15,168 |
| list with the peek open | 13,670 | 7,721 |
| cycle | 12,955 | 6,607 |
| Your work, assigned | 12,178 | 6,167 |

### 3.5 Dev against production, about 50 items (dev-metrics-compact.json, "d nav", n=5, 1440, CPU 1x)

| Click | dev | prod |
|---|---:|---:|
| Home → Projects | 138 | 58 |
| Projects → Work items | 1,338 | 928 |
| Work items → Cycles | 245 | 387 |
| Cycles → Inbox | 191 | 349 |
| Inbox → Analytics | 595 | 428 |
| Analytics → Home | 164 | 57 |
| prefetch requests per round | 0 | 45 |

Production's slower Cycles and Inbox clicks in that run are the 300 ms Suspense reveal throttle. With the throttle patched to 0 they took 101 and 63 ms. That is React behaviour, not Tessera code.

---

## 4. Daily use: run production

Use a production server for everyday work, and keep `next dev` only for looking at uncommitted agent work. Dev is slow by design: it never prefetches, compiles each page on first visit (Home about 2.5 s cold, most pages 0.25 to 0.84 s, a 25-page session about 29.5 s), adds about 340 ms the first time you open each of the 13 pages with an id in the URL after every restart, renders everything twice (Strict Mode) and ships 12 to 17 MB of JavaScript per page against about 3 MB in production. On the same code with about 50 items, production opens the work-item list in about 0.85 s (dev about 1.7 s), the table in 1.5 s (dev 2.3 s), Projects → Work items in 0.93 s (dev 1.34 s), and a page you already visited in 54 to 93 ms, because production prefetched it. The research run saw the same gap: Home 202 vs 589 ms, a work item 309 vs 797 ms. This round's row fix makes both faster: in production the list should drop to about 0.41 s, the table to about 0.6 to 0.8 s and the sidebar click to the list to about 0.54 s; in dev the list click should drop to about 0.9 to 1.0 s. The decided way to run production is decision 140. Roadmap lane A adds `npm run live`, which builds the last commit in its own release folder, serves it on http://127.0.0.1:3000 against your data/tessera.db, and comes with `live:update` and `live:rollback`. It also moves `npm run dev` to port 3001. So don't add a separate "build then start" script to package.json. If you want production before lane A lands, the exact interim one-line command is under needs_user_decision. It serves only committed work, and you stop your own dev server on port 3000 yourself.

**Update (2026-10-28):**
- Lane A has landed (commit `157c687`, `docs/process/live.md`). At HEAD `21f8ae3`, `npm run live`, `live:update`, `live:rollback`, `live:stop` and `live:status` exist, `npm run dev` serves port 3001 with `data/dev/tessera.db`, and port 3000 is your live production app. The interim one-liner in section 6 is no longer needed.
- This round's measured numbers came in at or under the expectations above: in production the list is 0.37 s, the table 0.57 s and the sidebar click to the list 0.47 s; in dev the Projects → Work items click is 0.58 s (section 1).
- You see them on port 3000 after the reconciler merges this round and runs `npm run live:update`.

---

## 5. Not done

- **Table-load profile target missed by 15 to 19 ms.** `checkTruncation` self time is 115 and 119 ms against ≤ 100 (the nav profile meets it at 88 and 94). The remainder comes from the ProjectFrame heading and the "Work items" Text in WorkItemsScreen, which both still use `maxLines`. They belong to roadmap lane B or a follow-up.
- **Decision 115 budget still missed on 10k:** list p95 1.1 s and table p95 2.0 s, against 300 ms. The next levers are lane B (decision 141), lane C (decision 142) and the Astryx lazy-mount issue.
- **The perf spec's board is bimodal (0.25 s or 1.0 to 1.35 s), on BEFORE as well as AFTER.** Board p95 ≤ 344 ms is not met in this run. The race already exists without the lanes, but nobody has traced its cause. Its likely place is the board reveal waiting behind start-up long tasks.
- **Found by lane rows, not regressions** (pixel-identical to HEAD):
  - On the board, a long state name in a column header overlaps the column's Add button: the StateLabel HStack in `.tessera-board-column-title` has no `min-width: 0` (board.css or BoardLayout).
  - At 375 px the open Assignees MultiSelector cuts a very long actor name at the listbox edge with no ellipsis.
- Field-guide line proposed for the reconciler (lane rows, extended by the review fix): "Astryx 0.6.8 Text maxLines measures every Text on mount (a forced layout each, even with hasTruncateTooltip={false}), and Popover keeps closed content mounted; per-row text uses a CSS one-line class with `OneLineText` (tooltip measured on hover), and per-row popovers pass `content={isOpen ? … : null}`."
- Other per-row popovers with heavy closed content were not audited beyond the list, table and gantt; the modules timeline was fixed with the gantt but not measured (a project has a few modules, not 10,000).
- The Astryx upstream regression test was checked with jsdom and SSR scripts against a cloned Astryx, but not in Astryx's own test harness.
- The macOS daily `/tmp` cleanup removed Measure-phase raw files from `PERF` between 2026-10-24 and 2026-10-28:
  - the per-sample `code-*` jsonl files, the probe scripts, `PERF/data/*.db` and parts of `PERF/prod/node_modules`.
  - The medians survive in BASELINE, and the probes survive in `docs/drafts/perf-2026-10-24/perf-run/scripts/`.
  - I restored the data sets from identical copies (md5 `86b68f…` for 10k, `e0235e…` for small), restored the probes from the perf-run folder, and repointed `PERF/scripts/node_modules` to `PERF/before2/node_modules`.

---

## 6. Needs you

1. **Run production for daily use now, before lane A lands.** This is **superseded**: lane A landed in `157c687`, and port 3000 already runs the live app (section 4). The original item is kept below for the record.
   - Exact interim one-liner (zsh). It builds the committed HEAD in `~/.tessera-interim` against a scratch build DB, then serves it on 3000 against your `data/tessera.db`:

     ```zsh
     export PATH=/opt/homebrew/bin:$PATH; R=~/Documents/Github/tessera; L=~/.tessera-interim; rm -rf "$L"; mkdir -p "$L/data"; git -C "$R" archive HEAD | tar -x -C "$L"; cp -Rc "$R/node_modules" "$L/"; cp "$R"/.env* "$L/" 2>/dev/null; cd "$L" && TESSERA_DB_PATH=data/build.db node node_modules/next/dist/bin/next build && { lsof -tiTCP:3000 -sTCP:LISTEN | xargs kill; TESSERA_DB_PATH="$R/data/tessera.db" nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000 > "$L/live.log" 2>&1 & }
     ```

     I do not recommend a separate package.json script: lane A's live.sh adds updates, rollback and a migration guard.
   - Why it needed you: it changes how you run the app. It stops your own dev server on port 3000, which no agent may touch. It serves only committed work, so uncommitted agent work needs `next dev` on another port. You re-run the command to pick up new commits.
   - Expected gain (same code, about 50 items, prod against dev at the time):
     - work-item list hard load about 0.85 s against 1.7 s;
     - table 1.5 s against 2.3 s;
     - Projects → Work items 0.93 s against 1.34 s;
     - revisits 54 to 93 ms (prefetched; dev never prefetches);
     - no first-visit compile (Home 2.5 s cold in dev, 0.25 to 0.84 s per page);
     - no 340 ms generate-params per dynamic route.
     - After lane rows: list about 0.41 s, table about 0.6 to 0.8 s (measured now: 0.37 s and 0.57 s).
2. **Approve filing the Astryx upstream issue and PR** that lane guard drafted (`docs/drafts/astryx-upstream-2026-10-24.md`, github.com/facebook/astryx). Later, approve the Astryx upgrade download (`npm run astryx -- upgrade --from 0.6.8 --apply`) once a release contains the fixes.
   - Why it needs you: posting on GitHub is public and needs your account, and an upgrade is a download and a dependency change. The project rule is to upgrade Astryx rather than add glue, so this is the only way the `moveTo`/`start`/`cancel` warning really goes away.
   - Expected gain:
     - It removes the only tolerated console warnings and their e2e tolerance.
     - Lazy truncation measuring in Astryx would let Tessera drop its own `OneLineText`, which now measures on hover so that row titles, table cells and gantt labels keep their overflow tooltip at no mount cost (review fix, section 2.9). Before lane rows, `checkTruncation` cost 6.7 s of a dev 10k navigation.
     - Lazy-mounting closed Selector and Tooltip layers is estimated to take another 30 to 50% off what remains after lane rows (10k list about 1.0 s → about 0.6 s). `readPortalWritingContext`, about 0.3 s per dev profile here, would go away.

---

## 7. How this run was measured, and what to keep

- **Copies:**
  - BEFORE = `PERF/before2`: `git archive 21f8ae3` plus an APFS clone of node_modules, built with `TESSERA_DB_PATH=data/build.db next build`.
  - AFTER = `PERF/after2`: built by the root; this run checked it against the lane folders.
  - `PERF/integ2-before-spec` is a BEFORE clone plus `tests/e2e/perf.spec.ts` and `playwright.perf.config.ts`, built fresh, used only for the BEFORE perf spec.
- **Data:** each arm gets a fresh copy of the 10k set (`PERF/data/p11-perf.db`, the decision 115 seed) or the small set (`PERF/data/small.db`), migrated with HEAD's `scripts/migrate.ts` (0 pending). The copies live in `PERF/integ2-data/`. The inline-edit arm gets its own copy, because it writes.
- **Servers:**
  - Production: `TESSERA_AUTOMATIONS=off TESSERA_WEBHOOKS=off next start -H 127.0.0.1`, without `ANTHROPIC_API_KEY`, on ports 3813 to 3816. Each sample starts a new server.
  - Dev: `next dev` on the same ports, cold-started per arm.
  - Port 3000 and `data/tessera.db` were never touched. All servers are stopped.
- **Scripts** (`PERF/scripts/`):
  - `integ2-ab-prod.sh`, `integ2-sample.mjs`: `lane-rows-sample.mjs` plus a `gridcell` count.
  - `integ2-ab-dev.sh`, `integ2-dev-profiles.sh`, `integ2-nav.sh`.
  - `integ2-perf-spec.sh`, `integ2-median.mjs`, `integ2-summary.mjs`, `integ2-measure-tables.mjs`.
  - The chain logs are `PERF/integ2-chain-prod.log`, `PERF/integ2-chain-dev.log` and `PERF/integ2-chain-spec.log`.
- **Results** (`PERF/results/integ2-*`):
  - per-sample jsonl with the load next to every sample, plus `-medians.json`;
  - the nav JSONs and the profile JSONs;
  - the perf spec logs, runs and results;
  - `integ2-summary.json`, which holds all of the above in one file.
- **Review fixes (section 2.9):** BEFORE-FIX = `PERF/after2-pre`, an APFS clone of AFTER with its build taken before the fixes; AFTER = `PERF/after2`, rebuilt with them. Ports 3812 (before) and 3817 (after). Data copies in `PERF/fix-data/`. Scripts `fix-gantt-sample.mjs`, `fix-ab.sh` (generic interleaved A/B, used with `fix-gantt-sample.mjs` and `integ2-sample.mjs`) and `fix-tooltip-visual.mjs`; results `PERF/results/fix-*`.
- **Kept in the repo, because the scratchpad gets wiped:** this report, as `docs/drafts/perf-report-2026-10-24.md`; `integ2-summary.json` and the review fixes' `fix-*-medians.json` in `docs/drafts/perf-2026-10-24/perf-run/baseline/`; `integ2-sample.mjs` and the `fix-*` scripts in `perf-run/scripts/` (`perf-run/README.md` lists them, and `docs/drafts/perf-2026-10-24/README.md` has a `perf-run/` row).

---

## Appendix A. Measure-phase metric lists (d26461b)

Generated from BASELINE `metrics.json` (production, engine and bundle; 373 rows) and `dev-metrics-compact.json` (dev; 123 rows). The notes are cut to 180 characters; the JSON files hold them in full. Times are in ms unless the metric says otherwise, and a few rows are counts or KB.

### A1. Production, engine and bundle (metrics.json, 373 rows)

#### prod small (153 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| prod small server home | HTML total (curl-like GET, uncompressed) | 19.8 | 20.7 | 7 | /; status 200; TTFB 1.4 ms; first hit 39.5 ms; 279.2 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server projects | HTML total (curl-like GET, uncompressed) | 12.9 | 13.2 | 7 | /projects; status 200; TTFB 1.5 ms; first hit 26.6 ms; 202.3 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server wi-list | HTML total (curl-like GET, uncompressed) | 54.4 | 72.1 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items; status 200; TTFB 1.7 ms; first hit 182.5 ms; 1084.8 KB raw HTML in 22 chunks (streamed: true); [data-list-ready] in stre… |
| prod small server wi-list-state | HTML total (curl-like GET, uncompressed) | 58.4 | 71.9 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items?q=eyJkaXNwbG…; status 200; TTFB 1.9 ms; first hit 81.5 ms; 1119.7 KB raw HTML in 22 chunks (streamed: true); [data-list-r… |
| prod small server wi-board-state | HTML total (curl-like GET, uncompressed) | 35.7 | 37.3 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items?q=eyJkaXNwbG…; status 200; TTFB 1.9 ms; first hit 50.9 ms; 718.9 KB raw HTML in 16 chunks (streamed: true); [data-list-re… |
| prod small server wi-table-state | HTML total (curl-like GET, uncompressed) | 81.1 | 93 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items?q=eyJkaXNwbG…; status 200; TTFB 1.8 ms; first hit 105.4 ms; 1491.5 KB raw HTML in 28 chunks (streamed: true); [data-list-… |
| prod small server wi-table | HTML total (curl-like GET, uncompressed) | 79.3 | 106 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items?q=eyJkaXNwbG…; status 200; TTFB 2.3 ms; first hit 87.7 ms; 1478.2 KB raw HTML in 28 chunks (streamed: true); [data-list-r… |
| prod small server wi-peek | HTML total (curl-like GET, uncompressed) | 58.4 | 68.7 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/work-items?peek=01a160d…; status 200; TTFB 2.1 ms; first hit 73.4 ms; 1095 KB raw HTML in 22 chunks (streamed: true); [data-list-rea… |
| prod small server work-item | HTML total (curl-like GET, uncompressed) | 23.1 | 24.3 | 7 | /work-items/01a160df-6440-736b-a03e-3ac1380b7a52; status 200; TTFB 1.9 ms; first hit 39.4 ms; 330.4 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a ms… |
| prod small server cycles | HTML total (curl-like GET, uncompressed) | 20.3 | 27.2 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/cycles; status 200; TTFB 1.6 ms; first hit 52.2 ms; 277.7 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n… |
| prod small server cycle | HTML total (curl-like GET, uncompressed) | 37.5 | 51.1 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/cycles/01a160df-6439-75…; status 200; TTFB 1.7 ms; first hit 50.4 ms; 621.2 KB raw HTML in 15 chunks (streamed: true); [data-list-re… |
| prod small server modules | HTML total (curl-like GET, uncompressed) | 18 | 19.1 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/modules; status 200; TTFB 1.8 ms; first hit 28.1 ms; 269.5 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at … |
| prod small server views | HTML total (curl-like GET, uncompressed) | 19.3 | 21.7 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/views; status 200; TTFB 1.6 ms; first hit 29.2 ms; 264.6 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/… |
| prod small server pages | HTML total (curl-like GET, uncompressed) | 19.6 | 26.5 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/pages; status 200; TTFB 1.7 ms; first hit 31.3 ms; 327.2 KB raw HTML in 10 chunks (streamed: true); [data-list-ready] in stream at n… |
| prod small server page | HTML total (curl-like GET, uncompressed) | 18.5 | 24.7 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/pages/01a160e1-a737-762…; status 200; TTFB 1.6 ms; first hit 27.6 ms; 280 KB raw HTML in 9 chunks (streamed: true); [data-list-ready… |
| prod small server intake | HTML total (curl-like GET, uncompressed) | 16.1 | 18.2 | 7 | /projects/01a160df-642f-7102-859a-8c50a72e7f1e/intake; status 200; TTFB 1.6 ms; first hit 31.1 ms; 264.7 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n… |
| prod small server inbox | HTML total (curl-like GET, uncompressed) | 12.9 | 14.1 | 7 | /inbox; status 200; TTFB 1.5 ms; first hit 23.5 ms; 242.2 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server yw-summary | HTML total (curl-like GET, uncompressed) | 16.4 | 17.4 | 7 | /your-work/summary; status 200; TTFB 1.6 ms; first hit 29.2 ms; 221.6 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 … |
| prod small server yw-assigned | HTML total (curl-like GET, uncompressed) | 32.4 | 37.8 | 7 | /your-work/assigned; status 200; TTFB 1.5 ms; first hit 35.7 ms; 518.4 KB raw HTML in 12 chunks (streamed: true); [data-list-ready] in stream at 28.9 ms; load 6.22 9.31 9.17 -> 5.… |
| prod small server agents | HTML total (curl-like GET, uncompressed) | 14.9 | 15.5 | 7 | /agents; status 200; TTFB 1.6 ms; first hit 22 ms; 197.3 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server drafts | HTML total (curl-like GET, uncompressed) | 12.1 | 13.9 | 7 | /drafts; status 200; TTFB 1.4 ms; first hit 18.2 ms; 198.7 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server workspace-views | HTML total (curl-like GET, uncompressed) | 13.8 | 14.9 | 7 | /workspace-views; status 200; TTFB 1.5 ms; first hit 20.3 ms; 210.1 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.… |
| prod small server active-cycles | HTML total (curl-like GET, uncompressed) | 11.9 | 12.6 | 7 | /active-cycles; status 200; TTFB 1.4 ms; first hit 19.1 ms; 199.1 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15… |
| prod small server analytics | HTML total (curl-like GET, uncompressed) | 18.8 | 21.6 | 7 | /analytics/overview; status 200; TTFB 1.4 ms; first hit 37.6 ms; 276 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9… |
| prod small server stickies | HTML total (curl-like GET, uncompressed) | 15.1 | 15.8 | 7 | /stickies; status 200; TTFB 1.5 ms; first hit 20.5 ms; 259.7 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server wiki | HTML total (curl-like GET, uncompressed) | 19.1 | 20.3 | 7 | /wiki; status 200; TTFB 1.5 ms; first hit 28.1 ms; 402 KB raw HTML in 11 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9.15 9.11 |
| prod small server settings | HTML total (curl-like GET, uncompressed) | 12.3 | 12.6 | 7 | /settings/general; status 200; TTFB 1.6 ms; first hit 18.7 ms; 199.2 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 6.22 9.31 9.17 -> 5.95 9… |
| prod small hard load home @1440 no throttle | navigation start -> ready | 173 | 266 | 5 | TTFB 4, FCP 64, LCP 64, hydrated 173, load 83 ms; long tasks total 0 ms (max 0); JS 884 KB transferred in 44 files, CSS 55 KB, HTML 31 KB gz / 241 KB raw; DOM nodes at ready 1402;… |
| prod small hard load projects @1440 no throttle | navigation start -> ready | 58 | 74 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 135, load 72 ms; long tasks total 0 ms (max 0); JS 606 KB transferred in 43 files, CSS 55 KB, HTML 27 KB gz / 202 KB raw; DOM nodes at ready 1045;… |
| prod small hard load wi-list @1440 no throttle | navigation start -> ready | 850 | 1,114 | 5 | TTFB 2, FCP 76, LCP 76, hydrated 851, load 157 ms; long tasks total 865 ms (max 685); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 64 KB gz / 1085 KB raw; DOM nodes at ready… |
| prod small hard load wi-list-state @1440 no throttle | navigation start -> ready | 813 | 893 | 5 | TTFB 3, FCP 80, LCP 80, hydrated 838, load 153 ms; long tasks total 839 ms (max 673); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 67 KB gz / 1120 KB raw; DOM nodes at ready… |
| prod small hard load wi-board-state @1440 no throttle | navigation start -> ready | 402 | 526 | 5 | TTFB 4, FCP 80, LCP 80, hydrated 447, load 151 ms; long tasks total 260 ms (max 260); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 57 KB gz / 719 KB raw; DOM nodes at ready … |
| prod small hard load wi-table-state @1440 no throttle | navigation start -> ready | 1,542 | 1,811 | 5 | TTFB 2, FCP 92, LCP 92, hydrated 1559, load 164 ms; long tasks total 1559 ms (max 1382); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 73 KB gz / 1491 KB raw; DOM nodes at re… |
| prod small hard load wi-table @1440 no throttle | navigation start -> ready | 1,531 | 1,980 | 5 | TTFB 3, FCP 104, LCP 104, hydrated 1531, load 150 ms; long tasks total 1530 ms (max 1348); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 71 KB gz / 1478 KB raw; DOM nodes at … |
| prod small hard load wi-peek @1440 no throttle | navigation start -> ready | 1,074 | 1,090 | 5 | TTFB 2, FCP 72, LCP 1096, hydrated 1074, load 121 ms; long tasks total 1089 ms (max 916); JS 994 KB transferred in 53 files, CSS 55 KB, HTML 65 KB gz / 1095 KB raw; DOM nodes at r… |
| prod small hard load work-item @1440 no throttle | navigation start -> ready | 82 | 296 | 5 | TTFB 3, FCP 60, LCP 64, hydrated 296, load 97 ms; long tasks total 164 ms (max 164); JS 912 KB transferred in 47 files, CSS 55 KB, HTML 39 KB gz / 330 KB raw; DOM nodes at ready 1… |
| prod small hard load cycles @1440 no throttle | navigation start -> ready | 226 | 252 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 226, load 84 ms; long tasks total 101 ms (max 101); JS 744 KB transferred in 50 files, CSS 55 KB, HTML 35 KB gz / 278 KB raw; DOM nodes at ready 1… |
| prod small hard load cycle @1440 no throttle | navigation start -> ready | 430 | 436 | 5 | TTFB 2, FCP 60, LCP 440, hydrated 430, load 122 ms; long tasks total 351 ms (max 294); JS 1116 KB transferred in 55 files, CSS 55 KB, HTML 56 KB gz / 621 KB raw; DOM nodes at read… |
| prod small hard load modules @1440 no throttle | navigation start -> ready | 63 | 179 | 5 | TTFB 2, FCP 52, LCP 52, hydrated 168, load 83 ms; long tasks total 0 ms (max 0); JS 629 KB transferred in 48 files, CSS 55 KB, HTML 35 KB gz / 270 KB raw; DOM nodes at ready 1323;… |
| prod small hard load views @1440 no throttle | navigation start -> ready | 69 | 176 | 5 | TTFB 2, FCP 56, LCP 56, hydrated 169, load 84 ms; long tasks total 0 ms (max 0); JS 620 KB transferred in 47 files, CSS 55 KB, HTML 35 KB gz / 265 KB raw; DOM nodes at ready 1283;… |
| prod small hard load pages @1440 no throttle | navigation start -> ready | 62 | 69 | 5 | TTFB 2, FCP 52, LCP 52, hydrated 167, load 81 ms; long tasks total 57 ms (max 57); JS 627 KB transferred in 48 files, CSS 55 KB, HTML 37 KB gz / 327 KB raw; DOM nodes at ready 161… |
| prod small hard load page @1440 no throttle | navigation start -> ready | 66 | 97 | 5 | TTFB 2, FCP 64, LCP 64, hydrated 251, load 85 ms; long tasks total 132 ms (max 132); JS 902 KB transferred in 50 files, CSS 55 KB, HTML 36 KB gz / 280 KB raw; DOM nodes at ready 1… |
| prod small hard load intake @1440 no throttle | navigation start -> ready | 65 | 70 | 5 | TTFB 2, FCP 56, LCP 56, hydrated 168, load 108 ms; long tasks total 50 ms (max 50); JS 930 KB transferred in 51 files, CSS 55 KB, HTML 35 KB gz / 265 KB raw; DOM nodes at ready 13… |
| prod small hard load inbox @1440 no throttle | navigation start -> ready | 65 | 72 | 5 | TTFB 3, FCP 60, LCP 60, hydrated 172, load 120 ms; long tasks total 0 ms (max 0); JS 929 KB transferred in 48 files, CSS 55 KB, HTML 30 KB gz / 242 KB raw; DOM nodes at ready 1285… |
| prod small hard load yw-summary @1440 no throttle | navigation start -> ready | 64 | 195 | 5 | TTFB 3, FCP 60, LCP 60, hydrated 151, load 83 ms; long tasks total 0 ms (max 0); JS 702 KB transferred in 46 files, CSS 55 KB, HTML 29 KB gz / 222 KB raw; DOM nodes at ready 1196;… |
| prod small hard load yw-assigned @1440 no throttle | navigation start -> ready | 334 | 370 | 5 | TTFB 2, FCP 72, LCP 72, hydrated 352, load 103 ms; long tasks total 270 ms (max 211); JS 702 KB transferred in 46 files, CSS 55 KB, HTML 45 KB gz / 518 KB raw; DOM nodes at ready … |
| prod small hard load agents @1440 no throttle | navigation start -> ready | 59 | 167 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 157, load 73 ms; long tasks total 0 ms (max 0); JS 609 KB transferred in 43 files, CSS 55 KB, HTML 26 KB gz / 197 KB raw; DOM nodes at ready 1059;… |
| prod small hard load drafts @1440 no throttle | navigation start -> ready | 66 | 220 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 138, load 71 ms; long tasks total 0 ms (max 0); JS 613 KB transferred in 43 files, CSS 55 KB, HTML 26 KB gz / 199 KB raw; DOM nodes at ready 1064;… |
| prod small hard load workspace-views @1440 no throttle | navigation start -> ready | 66 | 66 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 137, load 71 ms; long tasks total 0 ms (max 0); JS 611 KB transferred in 43 files, CSS 55 KB, HTML 28 KB gz / 210 KB raw; DOM nodes at ready 1116;… |
| prod small hard load active-cycles @1440 no throttle | navigation start -> ready | 190 | 204 | 5 | TTFB 3, FCP 60, LCP 60, hydrated 190, load 72 ms; long tasks total 85 ms (max 85); JS 733 KB transferred in 46 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at ready 126… |
| prod small hard load analytics @1440 no throttle | navigation start -> ready | 238 | 246 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 238, load 87 ms; long tasks total 114 ms (max 114); JS 743 KB transferred in 46 files, CSS 55 KB, HTML 32 KB gz / 276 KB raw; DOM nodes at ready 2… |
| prod small hard load stickies @1440 no throttle | navigation start -> ready | 60 | 68 | 5 | TTFB 2, FCP 64, LCP 240, hydrated 234, load 103 ms; long tasks total 124 ms (max 124); JS 884 KB transferred in 44 files, CSS 55 KB, HTML 30 KB gz / 260 KB raw; DOM nodes at ready… |
| prod small hard load wiki @1440 no throttle | navigation start -> ready | 64 | 207 | 5 | TTFB 2, FCP 52, LCP 52, hydrated 169, load 82 ms; long tasks total 53 ms (max 53); JS 620 KB transferred in 44 files, CSS 55 KB, HTML 33 KB gz / 402 KB raw; DOM nodes at ready 212… |
| prod small hard load settings @1440 no throttle | navigation start -> ready | 60 | 72 | 5 | TTFB 2, FCP 60, LCP 60, hydrated 136, load 70 ms; long tasks total 0 ms (max 0); JS 623 KB transferred in 46 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at ready 1050;… |
| prod small hard load home @375 CPU 4x | navigation start -> ready | 583 | 657 | 5 | TTFB 2, FCP 116, LCP 576, hydrated 583, load 244 ms; long tasks total 364 ms (max 175); JS 596 KB transferred in 40 files, CSS 55 KB, HTML 31 KB gz / 241 KB raw; DOM nodes at read… |
| prod small hard load projects @375 CPU 4x | navigation start -> ready | 123 | 395 | 5 | TTFB 2, FCP 112, LCP 548, hydrated 540, load 244 ms; long tasks total 271 ms (max 114); JS 606 KB transferred in 43 files, CSS 55 KB, HTML 27 KB gz / 202 KB raw; DOM nodes at read… |
| prod small hard load wi-list @375 CPU 4x | navigation start -> ready | 539 | 586 | 5 | TTFB 2, FCP 136, LCP 136, hydrated 3950, load 304 ms; long tasks total 4357 ms (max 3314); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 64 KB gz / 1085 KB raw; DOM nodes at … |
| prod small hard load wi-list-state @375 CPU 4x | navigation start -> ready | 566 | 574 | 5 | TTFB 2, FCP 140, LCP 140, hydrated 3850, load 317 ms; long tasks total 4192 ms (max 3223); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 67 KB gz / 1120 KB raw; DOM nodes at … |
| prod small hard load wi-board-state @375 CPU 4x | navigation start -> ready | 500 | 500 | 5 | TTFB 2, FCP 148, LCP 1788, hydrated 1736, load 285 ms; long tasks total 1510 ms (max 1197); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 57 KB gz / 719 KB raw; DOM nodes at … |
| prod small hard load wi-table-state @375 CPU 4x | navigation start -> ready | 651 | 695 | 5 | TTFB 2, FCP 168, LCP 168, hydrated 7019, load 351 ms; long tasks total 7485 ms (max 6315); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 73 KB gz / 1491 KB raw; DOM nodes at … |
| prod small hard load wi-table @375 CPU 4x | navigation start -> ready | 630 | 653 | 5 | TTFB 2, FCP 156, LCP 156, hydrated 6987, load 350 ms; long tasks total 7471 ms (max 6299); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 71 KB gz / 1478 KB raw; DOM nodes at … |
| prod small hard load wi-peek @375 CPU 4x | navigation start -> ready | 4,930 | 5,436 | 5 | TTFB 3, FCP 144, LCP 4968, hydrated 4932, load 336 ms; long tasks total 5383 ms (max 4284); JS 983 KB transferred in 49 files, CSS 55 KB, HTML 65 KB gz / 1095 KB raw; DOM nodes at… |
| prod small hard load work-item @375 CPU 4x | navigation start -> ready | 281 | 288 | 5 | TTFB 2, FCP 156, LCP 156, hydrated 1145, load 308 ms; long tasks total 851 ms (max 656); JS 904 KB transferred in 45 files, CSS 55 KB, HTML 39 KB gz / 330 KB raw; DOM nodes at rea… |
| prod small hard load cycles @375 CPU 4x | navigation start -> ready | 857 | 882 | 5 | TTFB 3, FCP 124, LCP 136, hydrated 857, load 265 ms; long tasks total 586 ms (max 410); JS 733 KB transferred in 46 files, CSS 55 KB, HTML 35 KB gz / 278 KB raw; DOM nodes at read… |
| prod small hard load cycle @375 CPU 4x | navigation start -> ready | 825 | 854 | 5 | TTFB 2, FCP 116, LCP 840, hydrated 1692, load 275 ms; long tasks total 1587 ms (max 844); JS 1105 KB transferred in 51 files, CSS 55 KB, HTML 56 KB gz / 621 KB raw; DOM nodes at r… |
| prod small hard load modules @375 CPU 4x | navigation start -> ready | 432 | 581 | 5 | TTFB 3, FCP 116, LCP 116, hydrated 664, load 243 ms; long tasks total 414 ms (max 226); JS 618 KB transferred in 44 files, CSS 55 KB, HTML 35 KB gz / 270 KB raw; DOM nodes at read… |
| prod small hard load views @375 CPU 4x | navigation start -> ready | 246 | 660 | 5 | TTFB 2, FCP 124, LCP 668, hydrated 660, load 257 ms; long tasks total 412 ms (max 213); JS 609 KB transferred in 43 files, CSS 55 KB, HTML 35 KB gz / 265 KB raw; DOM nodes at read… |
| prod small hard load pages @375 CPU 4x | navigation start -> ready | 427 | 437 | 5 | TTFB 2, FCP 124, LCP 124, hydrated 709, load 254 ms; long tasks total 445 ms (max 254); JS 617 KB transferred in 44 files, CSS 55 KB, HTML 37 KB gz / 327 KB raw; DOM nodes at read… |
| prod small hard load page @375 CPU 4x | navigation start -> ready | 400 | 402 | 5 | TTFB 2, FCP 112, LCP 408, hydrated 952, load 250 ms; long tasks total 707 ms (max 516); JS 891 KB transferred in 46 files, CSS 55 KB, HTML 36 KB gz / 280 KB raw; DOM nodes at read… |
| prod small hard load intake @375 CPU 4x | navigation start -> ready | 432 | 672 | 5 | TTFB 2, FCP 116, LCP 440, hydrated 676, load 253 ms; long tasks total 430 ms (max 238); JS 919 KB transferred in 47 files, CSS 55 KB, HTML 35 KB gz / 265 KB raw; DOM nodes at read… |
| prod small hard load inbox @375 CPU 4x | navigation start -> ready | 206 | 460 | 5 | TTFB 2, FCP 116, LCP 148, hydrated 688, load 247 ms; long tasks total 396 ms (max 239); JS 920 KB transferred in 46 files, CSS 55 KB, HTML 30 KB gz / 242 KB raw; DOM nodes at read… |
| prod small hard load yw-summary @375 CPU 4x | navigation start -> ready | 272 | 581 | 5 | TTFB 2, FCP 124, LCP 172, hydrated 581, load 237 ms; long tasks total 355 ms (max 155); JS 694 KB transferred in 44 files, CSS 55 KB, HTML 29 KB gz / 222 KB raw; DOM nodes at read… |
| prod small hard load yw-assigned @375 CPU 4x | navigation start -> ready | 477 | 1,287 | 5 | TTFB 2, FCP 136, LCP 140, hydrated 1529, load 261 ms; long tasks total 1463 ms (max 1014); JS 694 KB transferred in 44 files, CSS 55 KB, HTML 45 KB gz / 518 KB raw; DOM nodes at r… |
| prod small hard load agents @375 CPU 4x | navigation start -> ready | 250 | 584 | 5 | TTFB 2, FCP 116, LCP 116, hydrated 572, load 237 ms; long tasks total 323 ms (max 135); JS 601 KB transferred in 41 files, CSS 55 KB, HTML 26 KB gz / 197 KB raw; DOM nodes at read… |
| prod small hard load drafts @375 CPU 4x | navigation start -> ready | 129 | 214 | 5 | TTFB 2, FCP 120, LCP 120, hydrated 579, load 249 ms; long tasks total 300 ms (max 145); JS 605 KB transferred in 41 files, CSS 55 KB, HTML 26 KB gz / 199 KB raw; DOM nodes at read… |
| prod small hard load workspace-views @375 CPU 4x | navigation start -> ready | 129 | 562 | 5 | TTFB 2, FCP 120, LCP 124, hydrated 562, load 246 ms; long tasks total 299 ms (max 137); JS 603 KB transferred in 41 files, CSS 55 KB, HTML 28 KB gz / 210 KB raw; DOM nodes at read… |
| prod small hard load active-cycles @375 CPU 4x | navigation start -> ready | 735 | 787 | 5 | TTFB 2, FCP 120, LCP 128, hydrated 735, load 247 ms; long tasks total 474 ms (max 310); JS 724 KB transferred in 44 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at read… |
| prod small hard load analytics @375 CPU 4x | navigation start -> ready | 859 | 949 | 5 | TTFB 2, FCP 108, LCP 108, hydrated 859, load 233 ms; long tasks total 616 ms (max 424); JS 734 KB transferred in 44 files, CSS 55 KB, HTML 32 KB gz / 276 KB raw; DOM nodes at read… |
| prod small hard load stickies @375 CPU 4x | navigation start -> ready | 295 | 912 | 5 | TTFB 2, FCP 128, LCP 968, hydrated 954, load 263 ms; long tasks total 675 ms (max 504); JS 876 KB transferred in 42 files, CSS 55 KB, HTML 30 KB gz / 260 KB raw; DOM nodes at read… |
| prod small hard load wiki @375 CPU 4x | navigation start -> ready | 427 | 452 | 5 | TTFB 2, FCP 120, LCP 120, hydrated 709, load 260 ms; long tasks total 406 ms (max 251); JS 611 KB transferred in 42 files, CSS 55 KB, HTML 33 KB gz / 402 KB raw; DOM nodes at read… |
| prod small hard load settings @375 CPU 4x | navigation start -> ready | 232 | 504 | 5 | TTFB 2, FCP 120, LCP 120, hydrated 550, load 243 ms; long tasks total 286 ms (max 126); JS 615 KB transferred in 44 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at read… |
| prod small client nav cold home->projects @1440 no throttle | click -> ready | 58 | 66 | 5 | prefetched before click 5/5; nav RSC 9 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 55 ms in 1/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 ->… |
| prod small client nav cold projects->work-items @1440 no throttle | click -> ready | 953 | 967 | 5 | prefetched before click 5/5; nav RSC 28 ms / 14 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 39 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 … |
| prod small client nav cold work-items->cycles @1440 no throttle | click -> ready | 374 | 376 | 5 | prefetched before click 5/5; nav RSC 12 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 53 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 -… |
| prod small client nav cold cycles->inbox @1440 no throttle | click -> ready | 350 | 355 | 5 | prefetched before click 5/5; nav RSC 10 ms / 6 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 43 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 -… |
| prod small client nav cold inbox->analytics @1440 no throttle | click -> ready | 434 | 462 | 5 | prefetched before click 5/5; nav RSC 18 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 86 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 -… |
| prod small client nav cold analytics->home @1440 no throttle | click -> ready | 70 | 74 | 5 | prefetched before click 0/5; nav RSC 18.5 ms / 6 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 48 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74… |
| prod small client nav warm home->projects @1440 no throttle | click -> ready | 34 | 36 | 5 | prefetched before click 5/5; nav RSC 8 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at null ms in 0/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 … |
| prod small client nav warm projects->work-items @1440 no throttle | click -> ready | 700 | 770 | 5 | prefetched before click 5/5; nav RSC 16 ms / 14 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 33 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 … |
| prod small client nav warm work-items->cycles @1440 no throttle | click -> ready | 73 | 74 | 5 | prefetched before click 5/5; nav RSC 10.5 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 48 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74… |
| prod small client nav warm cycles->inbox @1440 no throttle | click -> ready | 54 | 58 | 5 | prefetched before click 5/5; nav RSC 9 ms / 6 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 38 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 ->… |
| prod small client nav warm inbox->analytics @1440 no throttle | click -> ready | 93 | 121 | 5 | prefetched before click 5/5; nav RSC 10.5 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 55 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74… |
| prod small client nav warm analytics->home @1440 no throttle | click -> ready | 68 | 89 | 5 | prefetched before click 0/5; nav RSC 14 ms / 6 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 50 ms in 5/5; main thread busy after ready 0 ms; load 9.48 18.46 15.74 -… |
| prod small client nav cold home->projects @1440 CPU 4x | click -> ready | 184 | 238 | 5 | prefetched before click 5/5; nav RSC 20.5 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 152 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.2… |
| prod small client nav cold projects->work-items @1440 CPU 4x | click -> ready | 3,527 | 4,887 | 5 | prefetched before click 5/5; nav RSC 26 ms / 14 KB (1 req); long tasks click->ready 169 ms; skeleton shown at 129 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.… |
| prod small client nav cold work-items->cycles @1440 CPU 4x | click -> ready | 735 | 852 | 5 | prefetched before click 5/5; nav RSC 48.5 ms / 5 KB (1 req); long tasks click->ready 147 ms; skeleton shown at 422 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14… |
| prod small client nav cold cycles->inbox @1440 CPU 4x | click -> ready | 308 | 395 | 5 | prefetched before click 5/5; nav RSC 19 ms / 6 KB (1 req); long tasks click->ready 62 ms; skeleton shown at 215 ms in 5/5; main thread busy after ready 922 ms; load 7.31 13.64 14.… |
| prod small client nav cold inbox->analytics @1440 CPU 4x | click -> ready | 585 | 972 | 5 | prefetched before click 5/5; nav RSC 24 ms / 5 KB (1 req); long tasks click->ready 78 ms; skeleton shown at null ms in 0/5; main thread busy after ready 0 ms; load 7.31 13.64 14.2… |
| prod small client nav cold analytics->home @1440 CPU 4x | click -> ready | 239 | 566 | 5 | prefetched before click 0/5; nav RSC 50 ms / 6 KB (1 req); long tasks click->ready 108 ms; skeleton shown at 182 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.2… |
| prod small client nav warm home->projects @1440 CPU 4x | click -> ready | 99 | 204 | 5 | prefetched before click 5/5; nav RSC 30 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 75 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.25 -… |
| prod small client nav warm projects->work-items @1440 CPU 4x | click -> ready | 3,627 | 5,929 | 5 | prefetched before click 5/5; nav RSC 40 ms / 14 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 75 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.25 … |
| prod small client nav warm work-items->cycles @1440 CPU 4x | click -> ready | 414 | 531 | 5 | prefetched before click 5/5; nav RSC 29 ms / 5 KB (1 req); long tasks click->ready 110 ms; skeleton shown at 285 ms in 5/5; main thread busy after ready 904 ms; load 7.31 13.64 14… |
| prod small client nav warm cycles->inbox @1440 CPU 4x | click -> ready | 218 | 504 | 5 | prefetched before click 5/5; nav RSC 10 ms / 6 KB (1 req); long tasks click->ready 54 ms; skeleton shown at 138 ms in 5/5; main thread busy after ready 950 ms; load 7.31 13.64 14.… |
| prod small client nav warm inbox->analytics @1440 CPU 4x | click -> ready | 438 | 1,012 | 5 | prefetched before click 5/5; nav RSC 17 ms / 5 KB (1 req); long tasks click->ready 71 ms; skeleton shown at 254 ms in 5/5; main thread busy after ready 944 ms; load 7.31 13.64 14.… |
| prod small client nav warm analytics->home @1440 CPU 4x | click -> ready | 208 | 618 | 5 | prefetched before click 0/5; nav RSC 109 ms / 6 KB (1 req); long tasks click->ready 98 ms; skeleton shown at 162 ms in 5/5; main thread busy after ready 0 ms; load 7.31 13.64 14.2… |
| prod small A/B client nav cold home->projects @1440 no throttle [A baseline] | click -> ready | 65.5 | 80 | 6 | interleaved rounds; skeleton at 57.5 ms in 6/6; nav RSC 13.5 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold projects->work-items @1440 no throttle [A baseline] | click -> ready | 880 | 914 | 6 | interleaved rounds; skeleton at 64.5 ms in 6/6; nav RSC 22 ms / 14 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold work-items->cycles @1440 no throttle [A baseline] | click -> ready | 387 | 397 | 6 | interleaved rounds; skeleton at 56 ms in 6/6; nav RSC 13 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold cycles->inbox @1440 no throttle [A baseline] | click -> ready | 216 | 366 | 6 | interleaved rounds; skeleton at 46 ms in 6/6; nav RSC 10.5 ms / 6 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold inbox->analytics @1440 no throttle [A baseline] | click -> ready | 435 | 441 | 6 | interleaved rounds; skeleton at 84.5 ms in 6/6; nav RSC 12 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold analytics->home @1440 no throttle [A baseline] | click -> ready | 68.5 | 70 | 6 | interleaved rounds; skeleton at 50 ms in 6/6; nav RSC 20 ms / 6 KB; prefetched 0/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm home->projects @1440 no throttle [A baseline] | click -> ready | 36 | 49 | 6 | interleaved rounds; skeleton at 32 ms in 1/6; nav RSC 12 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm projects->work-items @1440 no throttle [A baseline] | click -> ready | 627 | 669 | 6 | interleaved rounds; skeleton at 36 ms in 6/6; nav RSC 20.5 ms / 14 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm work-items->cycles @1440 no throttle [A baseline] | click -> ready | 74 | 76 | 6 | interleaved rounds; skeleton at 51 ms in 6/6; nav RSC 12 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm cycles->inbox @1440 no throttle [A baseline] | click -> ready | 59.5 | 61 | 6 | interleaved rounds; skeleton at 39.5 ms in 6/6; nav RSC 10 ms / 6 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm inbox->analytics @1440 no throttle [A baseline] | click -> ready | 95 | 96 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 13 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm analytics->home @1440 no throttle [A baseline] | click -> ready | 67 | 69 | 6 | interleaved rounds; skeleton at 47.5 ms in 6/6; nav RSC 18 ms / 6 KB; prefetched 0/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold home->projects @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 65.5 | 81 | 6 | interleaved rounds; skeleton at 57.5 ms in 6/6; nav RSC 11 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold projects->work-items @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 885 | 916 | 6 | interleaved rounds; skeleton at 48 ms in 6/6; nav RSC 26 ms / 14 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold work-items->cycles @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 152 | 158 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 10.5 ms / 4 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold cycles->inbox @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 73 | 79 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 9 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold inbox->analytics @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 435 | 442 | 6 | interleaved rounds; skeleton at 85 ms in 6/6; nav RSC 12.5 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold analytics->home @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 56.5 | 70 | 6 | interleaved rounds; skeleton at 46 ms in 6/6; nav RSC 16.5 ms / 6 KB; prefetched 0/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm home->projects @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 36.5 | 37 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 12 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm projects->work-items @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 625 | 663 | 6 | interleaved rounds; skeleton at 36 ms in 6/6; nav RSC 20 ms / 14 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm work-items->cycles @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 80 | 84 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 11.5 ms / 4 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm cycles->inbox @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 64.5 | 65 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 10 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm inbox->analytics @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 95 | 95 | 6 | interleaved rounds; skeleton at null ms in 0/6; nav RSC 13 ms / 5 KB; prefetched 6/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav warm analytics->home @1440 no throttle [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 55 | 71 | 6 | interleaved rounds; skeleton at 45 ms in 6/6; nav RSC 15 ms / 6 KB; prefetched 0/6; busy after 0 ms; load 4.34 7.59 7.34 -> 2.84 4.15 5.65 |
| prod small A/B client nav cold home->projects @1440 CPU 4x [A baseline] | click -> ready | 137 | 138 | 5 | interleaved rounds; skeleton at 104 ms in 5/5; nav RSC 9 ms / 5 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold projects->work-items @1440 CPU 4x [A baseline] | click -> ready | 2,775 | 2,789 | 5 | interleaved rounds; skeleton at 115 ms in 5/5; nav RSC 14 ms / 14 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold work-items->cycles @1440 CPU 4x [A baseline] | click -> ready | 389 | 408 | 5 | interleaved rounds; skeleton at 202 ms in 5/5; nav RSC 9 ms / 5 KB; prefetched 5/5; busy after 731 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold cycles->inbox @1440 CPU 4x [A baseline] | click -> ready | 209 | 222 | 5 | interleaved rounds; skeleton at 136 ms in 5/5; nav RSC 9 ms / 6 KB; prefetched 5/5; busy after 777 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold inbox->analytics @1440 CPU 4x [A baseline] | click -> ready | 446 | 453 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 12 ms / 5 KB; prefetched 5/5; busy after 797 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold analytics->home @1440 CPU 4x [A baseline] | click -> ready | 187 | 192 | 5 | interleaved rounds; skeleton at 147 ms in 5/5; nav RSC 12 ms / 6 KB; prefetched 0/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm home->projects @1440 CPU 4x [A baseline] | click -> ready | 85 | 86 | 5 | interleaved rounds; skeleton at 63 ms in 5/5; nav RSC 8 ms / 5 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm projects->work-items @1440 CPU 4x [A baseline] | click -> ready | 2,336 | 2,469 | 5 | interleaved rounds; skeleton at 66 ms in 5/5; nav RSC 11.5 ms / 14 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm work-items->cycles @1440 CPU 4x [A baseline] | click -> ready | 274 | 287 | 5 | interleaved rounds; skeleton at 177 ms in 5/5; nav RSC 10 ms / 5 KB; prefetched 5/5; busy after 733 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm cycles->inbox @1440 CPU 4x [A baseline] | click -> ready | 184 | 192 | 5 | interleaved rounds; skeleton at 121 ms in 5/5; nav RSC 8 ms / 6 KB; prefetched 5/5; busy after 755 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm inbox->analytics @1440 CPU 4x [A baseline] | click -> ready | 359 | 367 | 5 | interleaved rounds; skeleton at 218 ms in 5/5; nav RSC 12 ms / 5 KB; prefetched 5/5; busy after 761 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm analytics->home @1440 CPU 4x [A baseline] | click -> ready | 178 | 186 | 5 | interleaved rounds; skeleton at 139 ms in 5/5; nav RSC 13 ms / 6 KB; prefetched 0/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold home->projects @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 136 | 136 | 5 | interleaved rounds; skeleton at 103 ms in 5/5; nav RSC 9 ms / 5 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold projects->work-items @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 2,749 | 2,779 | 5 | interleaved rounds; skeleton at 116 ms in 5/5; nav RSC 13 ms / 14 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold work-items->cycles @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 583 | 588 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 9 ms / 4 KB; prefetched 5/5; busy after 772 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold cycles->inbox @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 251 | 262 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 7 ms / 5 KB; prefetched 5/5; busy after 741 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold inbox->analytics @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 446 | 493 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 12 ms / 5 KB; prefetched 5/5; busy after 781 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav cold analytics->home @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 174 | 184 | 5 | interleaved rounds; skeleton at 131 ms in 5/5; nav RSC 12 ms / 6 KB; prefetched 0/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm home->projects @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 72 | 87 | 5 | interleaved rounds; skeleton at 61 ms in 5/5; nav RSC 8 ms / 5 KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm projects->work-items @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 2,398 | 2,468 | 5 | interleaved rounds; skeleton at 64 ms in 5/5; nav RSC null ms / null KB; prefetched 5/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm work-items->cycles @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 311 | 317 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 10 ms / 4 KB; prefetched 5/5; busy after 762 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm cycles->inbox @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 213 | 223 | 5 | interleaved rounds; skeleton at null ms in 0/5; nav RSC 7 ms / 5 KB; prefetched 5/5; busy after 739 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm inbox->analytics @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 358 | 363 | 5 | interleaved rounds; skeleton at 206 ms in 5/5; nav RSC 12 ms / 5 KB; prefetched 5/5; busy after 758 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |
| prod small A/B client nav warm analytics->home @1440 CPU 4x [B blocking experiment (inbox+cycles: instant=false, no page Suspense)] | click -> ready | 174 | 182 | 5 | interleaved rounds; skeleton at 134 ms in 5/5; nav RSC 13 ms / 6 KB; prefetched 0/5; busy after 0 ms; load 2.81 4.08 5.60 -> 3.06 3.02 4.36 |

#### prod large (127 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| prod large server home | HTML total (curl-like GET, uncompressed) | 116 | 340 | 7 | /; status 200; TTFB 1.6 ms; first hit 339.2 ms; 208.8 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server projects | HTML total (curl-like GET, uncompressed) | 22.2 | 27.7 | 7 | /projects; status 200; TTFB 1.6 ms; first hit 36.8 ms; 202 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server wi-list | HTML total (curl-like GET, uncompressed) | 230 | 256 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items; status 200; TTFB 1.6 ms; first hit 407.7 ms; 3578.5 KB raw HTML in 60 chunks (streamed: true); [data-list-ready] in stre… |
| prod large server wi-list-state | HTML total (curl-like GET, uncompressed) | 327 | 358 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items?q=eyJkaXNwbG…; status 200; TTFB 2.1 ms; first hit 351.2 ms; 4427.1 KB raw HTML in 74 chunks (streamed: true); [data-list-… |
| prod large server wi-board-state | HTML total (curl-like GET, uncompressed) | 105 | 119 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items?q=eyJkaXNwbG…; status 200; TTFB 2.2 ms; first hit 108.9 ms; 1582.6 KB raw HTML in 29 chunks (streamed: true); [data-list-… |
| prod large server wi-table-state | HTML total (curl-like GET, uncompressed) | 477 | 535 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items?q=eyJkaXNwbG…; status 200; TTFB 2 ms; first hit 553.6 ms; 5706.1 KB raw HTML in 94 chunks (streamed: true); [data-list-re… |
| prod large server wi-table | HTML total (curl-like GET, uncompressed) | 333 | 403 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items?q=eyJkaXNwbG…; status 200; TTFB 2.1 ms; first hit 374.5 ms; 4618.2 KB raw HTML in 77 chunks (streamed: true); [data-list-… |
| prod large server wi-peek | HTML total (curl-like GET, uncompressed) | 241 | 266 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/work-items?peek=01a16ad…; status 200; TTFB 2.1 ms; first hit 259.6 ms; 3589.2 KB raw HTML in 60 chunks (streamed: true); [data-list-… |
| prod large server work-item | HTML total (curl-like GET, uncompressed) | 41.8 | 58.8 | 7 | /work-items/01a16ad8-6e4b-75e0-a1b9-93396ad2e9a6; status 200; TTFB 2 ms; first hit 59.6 ms; 358.4 KB raw HTML in 10 chunks (streamed: true); [data-list-ready] in stream at n/a ms;… |
| prod large server cycles | HTML total (curl-like GET, uncompressed) | 46.9 | 58.5 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/cycles; status 200; TTFB 1.7 ms; first hit 79 ms; 410.5 KB raw HTML in 11 chunks (streamed: true); [data-list-ready] in stream at n/… |
| prod large server cycle | HTML total (curl-like GET, uncompressed) | 259 | 272 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/cycles/01a16ad8-6e1d-70…; status 200; TTFB 1.8 ms; first hit 276 ms; 3592.8 KB raw HTML in 61 chunks (streamed: true); [data-list-re… |
| prod large server modules | HTML total (curl-like GET, uncompressed) | 56.6 | 68.6 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/modules; status 200; TTFB 2 ms; first hit 79.1 ms; 521.9 KB raw HTML in 13 chunks (streamed: true); [data-list-ready] in stream at n… |
| prod large server views | HTML total (curl-like GET, uncompressed) | 40.1 | 54.5 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/views; status 200; TTFB 1.8 ms; first hit 59.1 ms; 272.4 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/… |
| prod large server pages | HTML total (curl-like GET, uncompressed) | 42.7 | 53 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/pages; status 200; TTFB 1.7 ms; first hit 51.3 ms; 294.2 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/… |
| prod large server intake | HTML total (curl-like GET, uncompressed) | 37.6 | 51.3 | 7 | /projects/01a16ad8-6ddd-7752-91fa-653ae8b8a394/intake; status 200; TTFB 1.7 ms; first hit 42 ms; 266.6 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a… |
| prod large server inbox | HTML total (curl-like GET, uncompressed) | 17.7 | 19.4 | 7 | /inbox; status 200; TTFB 1.5 ms; first hit 22.4 ms; 194.7 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server yw-summary | HTML total (curl-like GET, uncompressed) | 98.3 | 114 | 7 | /your-work/summary; status 200; TTFB 1.6 ms; first hit 115.4 ms; 232.6 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01… |
| prod large server yw-assigned | HTML total (curl-like GET, uncompressed) | 321 | 344 | 7 | /your-work/assigned; status 200; TTFB 1.7 ms; first hit 317 ms; 3179.9 KB raw HTML in 55 chunks (streamed: true); [data-list-ready] in stream at 245.3 ms; load 5.78 8.80 8.99 -> 6… |
| prod large server agents | HTML total (curl-like GET, uncompressed) | 71.1 | 89.6 | 7 | /agents; status 200; TTFB 2.1 ms; first hit 100 ms; 207.3 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server drafts | HTML total (curl-like GET, uncompressed) | 22.8 | 38.1 | 7 | /drafts; status 200; TTFB 1.6 ms; first hit 41.4 ms; 188.1 KB raw HTML in 7 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server workspace-views | HTML total (curl-like GET, uncompressed) | 17.2 | 19 | 7 | /workspace-views; status 200; TTFB 1.5 ms; first hit 23.4 ms; 193.5 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.… |
| prod large server active-cycles | HTML total (curl-like GET, uncompressed) | 25.6 | 33.9 | 7 | /active-cycles; status 200; TTFB 1.5 ms; first hit 59.8 ms; 198.7 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56… |
| prod large server analytics | HTML total (curl-like GET, uncompressed) | 78.3 | 80.8 | 7 | /analytics/overview; status 200; TTFB 1.6 ms; first hit 88.8 ms; 287.4 KB raw HTML in 9 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01… |
| prod large server stickies | HTML total (curl-like GET, uncompressed) | 16.1 | 17.6 | 7 | /stickies; status 200; TTFB 1.6 ms; first hit 22.4 ms; 190.6 KB raw HTML in 7 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server wiki | HTML total (curl-like GET, uncompressed) | 22.2 | 24.2 | 7 | /wiki; status 200; TTFB 1.4 ms; first hit 24.1 ms; 193.7 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8.56 8.89 |
| prod large server settings | HTML total (curl-like GET, uncompressed) | 17.3 | 21.6 | 7 | /settings/general; status 200; TTFB 1.6 ms; first hit 22.5 ms; 194.9 KB raw HTML in 8 chunks (streamed: true); [data-list-ready] in stream at n/a ms; load 5.78 8.80 8.99 -> 6.01 8… |
| prod large hard load home @1440 no throttle | navigation start -> ready | 564 | 722 | 5 | TTFB 3, FCP 420, LCP 568, hydrated 564, load 465 ms; long tasks total 56 ms (max 56); JS 884 KB transferred in 44 files, CSS 55 KB, HTML 27 KB gz / 208 KB raw; DOM nodes at ready … |
| prod large hard load projects @1440 no throttle | navigation start -> ready | 183 | 212 | 5 | TTFB 3, FCP 64, LCP 64, hydrated 183, load 99 ms; long tasks total 0 ms (max 0); JS 606 KB transferred in 43 files, CSS 55 KB, HTML 26 KB gz / 202 KB raw; DOM nodes at ready 1173;… |
| prod large hard load wi-list @1440 no throttle | navigation start -> ready | 7,224 | 7,652 | 5 | TTFB 2, FCP 228, LCP 7276, hydrated 7225, load 296 ms; long tasks total 7572 ms (max 6865); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 141 KB gz / 3578 KB raw; DOM nodes a… |
| prod large hard load wi-list-state @1440 no throttle | navigation start -> ready | 9,381 | 10,087 | 5 | TTFB 4, FCP 264, LCP 9480, hydrated 9383, load 332 ms; long tasks total 9760 ms (max 8972); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 169 KB gz / 4427 KB raw; DOM nodes a… |
| prod large hard load wi-board-state @1440 no throttle | navigation start -> ready | 1,414 | 1,587 | 5 | TTFB 3, FCP 160, LCP 1440, hydrated 1415, load 214 ms; long tasks total 1183 ms (max 1094); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 86 KB gz / 1583 KB raw; DOM nodes at… |
| prod large hard load wi-table-state @1440 no throttle | navigation start -> ready | 25,494 | 27,516 | 5 | TTFB 2, FCP 320, LCP 25596, hydrated 25496, load 410 ms; long tasks total 26139 ms (max 24971); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 186 KB gz / 5706 KB raw; DOM nod… |
| prod large hard load wi-table @1440 no throttle | navigation start -> ready | 16,842 | 18,701 | 5 | TTFB 4, FCP 352, LCP 16900, hydrated 16843, load 438 ms; long tasks total 17085 ms (max 16292); JS 993 KB transferred in 52 files, CSS 55 KB, HTML 159 KB gz / 4618 KB raw; DOM nod… |
| prod large hard load wi-peek @1440 no throttle | navigation start -> ready | 7,600 | 8,915 | 5 | TTFB 3, FCP 284, LCP 7664, hydrated 7602, load 394 ms; long tasks total 7935 ms (max 7167); JS 994 KB transferred in 53 files, CSS 55 KB, HTML 143 KB gz / 3589 KB raw; DOM nodes a… |
| prod large hard load work-item @1440 no throttle | navigation start -> ready | 319 | 361 | 5 | TTFB 3, FCP 88, LCP 328, hydrated 329, load 147 ms; long tasks total 171 ms (max 171); JS 912 KB transferred in 47 files, CSS 55 KB, HTML 41 KB gz / 358 KB raw; DOM nodes at ready… |
| prod large hard load cycles @1440 no throttle | navigation start -> ready | 273 | 343 | 5 | TTFB 3, FCP 88, LCP 256, hydrated 273, load 131 ms; long tasks total 117 ms (max 117); JS 744 KB transferred in 50 files, CSS 55 KB, HTML 41 KB gz / 411 KB raw; DOM nodes at ready… |
| prod large hard load cycle @1440 no throttle | navigation start -> ready | 6,447 | 8,388 | 5 | TTFB 2, FCP 264, LCP 6412, hydrated 6448, load 341 ms; long tasks total 6653 ms (max 6079); JS 1116 KB transferred in 55 files, CSS 55 KB, HTML 156 KB gz / 3593 KB raw; DOM nodes … |
| prod large hard load modules @1440 no throttle | navigation start -> ready | 261 | 666 | 5 | TTFB 3, FCP 92, LCP 92, hydrated 261, load 130 ms; long tasks total 89 ms (max 89); JS 629 KB transferred in 48 files, CSS 55 KB, HTML 42 KB gz / 522 KB raw; DOM nodes at ready 49… |
| prod large hard load views @1440 no throttle | navigation start -> ready | 182 | 217 | 5 | TTFB 2, FCP 68, LCP 188, hydrated 192, load 102 ms; long tasks total 0 ms (max 0); JS 620 KB transferred in 47 files, CSS 55 KB, HTML 35 KB gz / 272 KB raw; DOM nodes at ready 157… |
| prod large hard load pages @1440 no throttle | navigation start -> ready | 197 | 380 | 5 | TTFB 2, FCP 76, LCP 76, hydrated 204, load 107 ms; long tasks total 54 ms (max 54); JS 627 KB transferred in 48 files, CSS 55 KB, HTML 37 KB gz / 294 KB raw; DOM nodes at ready 16… |
| prod large hard load intake @1440 no throttle | navigation start -> ready | 195 | 617 | 5 | TTFB 2, FCP 68, LCP 200, hydrated 195, load 143 ms; long tasks total 50 ms (max 50); JS 932 KB transferred in 52 files, CSS 55 KB, HTML 35 KB gz / 267 KB raw; DOM nodes at ready 1… |
| prod large hard load inbox @1440 no throttle | navigation start -> ready | 63 | 316 | 5 | TTFB 2, FCP 64, LCP 64, hydrated 149, load 85 ms; long tasks total 0 ms (max 0); JS 929 KB transferred in 48 files, CSS 55 KB, HTML 26 KB gz / 195 KB raw; DOM nodes at ready 1034;… |
| prod large hard load yw-summary @1440 no throttle | navigation start -> ready | 286 | 460 | 5 | TTFB 2, FCP 160, LCP 160, hydrated 286, load 203 ms; long tasks total 50 ms (max 50); JS 702 KB transferred in 46 files, CSS 55 KB, HTML 30 KB gz / 233 KB raw; DOM nodes at ready … |
| prod large hard load yw-assigned @1440 no throttle | navigation start -> ready | 5,788 | 7,664 | 5 | TTFB 2, FCP 296, LCP 5820, hydrated 5789, load 365 ms; long tasks total 6125 ms (max 5368); JS 702 KB transferred in 46 files, CSS 55 KB, HTML 117 KB gz / 3180 KB raw; DOM nodes a… |
| prod large hard load agents @1440 no throttle | navigation start -> ready | 224 | 306 | 5 | TTFB 5, FCP 140, LCP 140, hydrated 253, load 171 ms; long tasks total 0 ms (max 0); JS 609 KB transferred in 43 files, CSS 55 KB, HTML 26 KB gz / 207 KB raw; DOM nodes at ready 13… |
| prod large hard load drafts @1440 no throttle | navigation start -> ready | 66 | 203 | 5 | TTFB 2, FCP 52, LCP 52, hydrated 148, load 84 ms; long tasks total 0 ms (max 0); JS 613 KB transferred in 43 files, CSS 55 KB, HTML 25 KB gz / 188 KB raw; DOM nodes at ready 1007;… |
| prod large hard load workspace-views @1440 no throttle | navigation start -> ready | 67 | 186 | 5 | TTFB 2, FCP 56, LCP 56, hydrated 148, load 83 ms; long tasks total 0 ms (max 0); JS 611 KB transferred in 43 files, CSS 55 KB, HTML 25 KB gz / 194 KB raw; DOM nodes at ready 1038;… |
| prod large hard load active-cycles @1440 no throttle | navigation start -> ready | 213 | 236 | 5 | TTFB 3, FCP 56, LCP 220, hydrated 213, load 90 ms; long tasks total 85 ms (max 85); JS 733 KB transferred in 46 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at ready 13… |
| prod large hard load analytics @1440 no throttle | navigation start -> ready | 333 | 375 | 5 | TTFB 3, FCP 132, LCP 292, hydrated 333, load 174 ms; long tasks total 131 ms (max 131); JS 743 KB transferred in 46 files, CSS 55 KB, HTML 31 KB gz / 287 KB raw; DOM nodes at read… |
| prod large hard load stickies @1440 no throttle | navigation start -> ready | 68 | 266 | 5 | TTFB 3, FCP 56, LCP 64, hydrated 192, load 126 ms; long tasks total 61 ms (max 61); JS 884 KB transferred in 44 files, CSS 55 KB, HTML 26 KB gz / 191 KB raw; DOM nodes at ready 10… |
| prod large hard load wiki @1440 no throttle | navigation start -> ready | 69 | 195 | 5 | TTFB 3, FCP 56, LCP 56, hydrated 160, load 88 ms; long tasks total 0 ms (max 0); JS 620 KB transferred in 44 files, CSS 55 KB, HTML 26 KB gz / 194 KB raw; DOM nodes at ready 1030;… |
| prod large hard load settings @1440 no throttle | navigation start -> ready | 69 | 215 | 5 | TTFB 3, FCP 60, LCP 60, hydrated 155, load 81 ms; long tasks total 0 ms (max 0); JS 623 KB transferred in 46 files, CSS 55 KB, HTML 26 KB gz / 195 KB raw; DOM nodes at ready 1023;… |
| prod large hard load home @375 CPU 4x | navigation start -> ready | 862 | 1,056 | 5 | TTFB 3, FCP 364, LCP 704, hydrated 862, load 502 ms; long tasks total 326 ms (max 146); JS 876 KB transferred in 42 files, CSS 55 KB, HTML 27 KB gz / 208 KB raw; DOM nodes at read… |
| prod large hard load projects @375 CPU 4x | navigation start -> ready | 191 | 433 | 5 | TTFB 3, FCP 124, LCP 588, hydrated 578, load 269 ms; long tasks total 280 ms (max 125); JS 606 KB transferred in 43 files, CSS 55 KB, HTML 26 KB gz / 202 KB raw; DOM nodes at read… |
| prod large hard load wi-list @375 CPU 4x | navigation start -> ready | 1,152 | 1,477 | 5 | TTFB 4, FCP 356, LCP 356, hydrated 34915, load 696 ms; long tasks total 34669 ms (max 33647); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 141 KB gz / 3578 KB raw; DOM nodes… |
| prod large hard load wi-list-state @375 CPU 4x | navigation start -> ready | 1,441 | 1,588 | 5 | TTFB 7, FCP 568, LCP 568, hydrated 47637, load 956 ms; long tasks total 47540 ms (max 46288); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 169 KB gz / 4427 KB raw; DOM nodes… |
| prod large hard load wi-board-state @375 CPU 4x | navigation start -> ready | 707 | 775 | 5 | TTFB 4, FCP 228, LCP 5568, hydrated 5449, load 459 ms; long tasks total 5097 ms (max 4728); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 86 KB gz / 1583 KB raw; DOM nodes at… |
| prod large hard load wi-table-state @375 CPU 4x | navigation start -> ready | 1,531 | 1,637 | 4 | TTFB 3, FCP 410, LCP 1670, hydrated 123183, load 794 ms; long tasks total 123559 ms (max 121487); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 186 KB gz / 5706 KB raw; DOM n… |
| prod large hard load wi-table @375 CPU 4x | navigation start -> ready | 1,411 | 1,540 | 5 | TTFB 4, FCP 436, LCP 1516, hydrated 73754, load 841 ms; long tasks total 74120 ms (max 72244); JS 982 KB transferred in 48 files, CSS 55 KB, HTML 159 KB gz / 4618 KB raw; DOM node… |
| prod large hard load wi-peek @375 CPU 4x | navigation start -> ready | 37,657 | 43,555 | 5 | TTFB 5, FCP 348, LCP 348, hydrated 37662, load 710 ms; long tasks total 37549 ms (max 36367); JS 983 KB transferred in 49 files, CSS 55 KB, HTML 143 KB gz / 3589 KB raw; DOM nodes… |
| prod large hard load work-item @375 CPU 4x | navigation start -> ready | 422 | 538 | 5 | TTFB 4, FCP 164, LCP 432, hydrated 1360, load 333 ms; long tasks total 945 ms (max 780); JS 904 KB transferred in 45 files, CSS 55 KB, HTML 41 KB gz / 358 KB raw; DOM nodes at rea… |
| prod large hard load cycles @375 CPU 4x | navigation start -> ready | 980 | 1,124 | 5 | TTFB 3, FCP 144, LCP 144, hydrated 980, load 286 ms; long tasks total 661 ms (max 500); JS 733 KB transferred in 46 files, CSS 55 KB, HTML 41 KB gz / 411 KB raw; DOM nodes at read… |
| prod large hard load cycle @375 CPU 4x | navigation start -> ready | 1,602 | 4,228 | 5 | TTFB 4, FCP 384, LCP 1592, hydrated 29593, load 761 ms; long tasks total 32004 ms (max 27840); JS 1105 KB transferred in 51 files, CSS 55 KB, HTML 156 KB gz / 3593 KB raw; DOM nod… |
| prod large hard load modules @375 CPU 4x | navigation start -> ready | 484 | 1,402 | 5 | TTFB 3, FCP 152, LCP 152, hydrated 920, load 295 ms; long tasks total 570 ms (max 405); JS 618 KB transferred in 44 files, CSS 55 KB, HTML 42 KB gz / 522 KB raw; DOM nodes at read… |
| prod large hard load views @375 CPU 4x | navigation start -> ready | 415 | 1,771 | 5 | TTFB 3, FCP 136, LCP 424, hydrated 665, load 267 ms; long tasks total 420 ms (max 217); JS 609 KB transferred in 43 files, CSS 55 KB, HTML 35 KB gz / 272 KB raw; DOM nodes at read… |
| prod large hard load pages @375 CPU 4x | navigation start -> ready | 631 | 706 | 5 | TTFB 3, FCP 140, LCP 560, hydrated 680, load 269 ms; long tasks total 392 ms (max 226); JS 617 KB transferred in 44 files, CSS 55 KB, HTML 37 KB gz / 294 KB raw; DOM nodes at read… |
| prod large hard load intake @375 CPU 4x | navigation start -> ready | 446 | 574 | 5 | TTFB 4, FCP 140, LCP 452, hydrated 691, load 279 ms; long tasks total 372 ms (max 194); JS 922 KB transferred in 49 files, CSS 55 KB, HTML 35 KB gz / 267 KB raw; DOM nodes at read… |
| prod large hard load inbox @375 CPU 4x | navigation start -> ready | 241 | 480 | 5 | TTFB 4, FCP 132, LCP 132, hydrated 601, load 266 ms; long tasks total 331 ms (max 139); JS 920 KB transferred in 46 files, CSS 55 KB, HTML 26 KB gz / 195 KB raw; DOM nodes at read… |
| prod large hard load yw-summary @375 CPU 4x | navigation start -> ready | 639 | 2,204 | 5 | TTFB 3, FCP 284, LCP 672, hydrated 813, load 460 ms; long tasks total 361 ms (max 165); JS 694 KB transferred in 44 files, CSS 55 KB, HTML 30 KB gz / 233 KB raw; DOM nodes at read… |
| prod large hard load yw-assigned @375 CPU 4x | navigation start -> ready | 1,274 | 5,664 | 5 | TTFB 4, FCP 548, LCP 548, hydrated 26978, load 853 ms; long tasks total 26527 ms (max 25485); JS 694 KB transferred in 44 files, CSS 55 KB, HTML 117 KB gz / 3180 KB raw; DOM nodes… |
| prod large hard load agents @375 CPU 4x | navigation start -> ready | 661 | 989 | 5 | TTFB 4, FCP 272, LCP 272, hydrated 724, load 412 ms; long tasks total 327 ms (max 151); JS 601 KB transferred in 41 files, CSS 55 KB, HTML 26 KB gz / 207 KB raw; DOM nodes at read… |
| prod large hard load drafts @375 CPU 4x | navigation start -> ready | 140 | 560 | 5 | TTFB 3, FCP 132, LCP 132, hydrated 572, load 272 ms; long tasks total 280 ms (max 120); JS 605 KB transferred in 41 files, CSS 55 KB, HTML 25 KB gz / 188 KB raw; DOM nodes at read… |
| prod large hard load workspace-views @375 CPU 4x | navigation start -> ready | 526 | 591 | 5 | TTFB 5, FCP 124, LCP 532, hydrated 603, load 269 ms; long tasks total 317 ms (max 136); JS 603 KB transferred in 41 files, CSS 55 KB, HTML 25 KB gz / 194 KB raw; DOM nodes at read… |
| prod large hard load active-cycles @375 CPU 4x | navigation start -> ready | 748 | 1,076 | 5 | TTFB 4, FCP 128, LCP 136, hydrated 748, load 265 ms; long tasks total 457 ms (max 301); JS 724 KB transferred in 44 files, CSS 55 KB, HTML 27 KB gz / 199 KB raw; DOM nodes at read… |
| prod large hard load analytics @375 CPU 4x | navigation start -> ready | 958 | 1,185 | 5 | TTFB 5, FCP 152, LCP 152, hydrated 958, load 331 ms; long tasks total 644 ms (max 443); JS 734 KB transferred in 44 files, CSS 55 KB, HTML 31 KB gz / 287 KB raw; DOM nodes at read… |
| prod large hard load stickies @375 CPU 4x | navigation start -> ready | 201 | 699 | 5 | TTFB 4, FCP 128, LCP 164, hydrated 739, load 264 ms; long tasks total 462 ms (max 288); JS 876 KB transferred in 42 files, CSS 55 KB, HTML 26 KB gz / 191 KB raw; DOM nodes at read… |
| prod large hard load wiki @375 CPU 4x | navigation start -> ready | 430 | 548 | 5 | TTFB 5, FCP 124, LCP 440, hydrated 610, load 259 ms; long tasks total 299 ms (max 143); JS 611 KB transferred in 42 files, CSS 55 KB, HTML 26 KB gz / 194 KB raw; DOM nodes at read… |
| prod large hard load settings @375 CPU 4x | navigation start -> ready | 446 | 541 | 5 | TTFB 3, FCP 124, LCP 452, hydrated 609, load 263 ms; long tasks total 298 ms (max 139); JS 615 KB transferred in 44 files, CSS 55 KB, HTML 26 KB gz / 195 KB raw; DOM nodes at read… |
| prod large client nav cold home->projects @1440 no throttle | click -> ready | 55 | 56 | 5 | prefetched before click 5/5; nav RSC 20 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at null ms in 0/5; main thread busy after ready 0 ms; load 11.61 14.15 14.8… |
| prod large client nav cold projects->work-items @1440 no throttle | click -> ready | 7,245 | 7,562 | 5 | prefetched before click 5/5; nav RSC 49 ms / 29 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 37 ms in 5/5; main thread busy after ready 0 ms; load 11.61 14.15 14.83… |
| prod large client nav cold work-items->cycles @1440 no throttle | click -> ready | 201 | 447 | 5 | prefetched before click 5/5; nav RSC 44 ms / 6 KB (1 req); long tasks click->ready 68 ms; skeleton shown at 116 ms in 5/5; main thread busy after ready 826 ms; load 11.61 14.15 14… |
| prod large client nav cold cycles->inbox @1440 no throttle | click -> ready | 91 | 363 | 5 | prefetched before click 5/5; nav RSC 11 ms / 4 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 79 ms in 5/5; main thread busy after ready 872 ms; load 11.61 14.15 14.8… |
| prod large client nav cold inbox->analytics @1440 no throttle | click -> ready | 563 | 850 | 5 | prefetched before click 5/5; nav RSC 101 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 222 ms in 5/5; main thread busy after ready 807 ms; load 11.61 14.15 14… |
| prod large client nav cold analytics->home @1440 no throttle | click -> ready | 366 | 564 | 5 | prefetched before click 0/5; nav RSC null ms / null KB (1 req); long tasks click->ready 87 ms; skeleton shown at 114 ms in 5/5; main thread busy after ready 0 ms; load 11.61 14.15… |
| prod large client nav warm home->projects @1440 no throttle | click -> ready | 35 | 37 | 5 | prefetched before click 5/5; nav RSC 14 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at null ms in 0/5; main thread busy after ready 0 ms; load 11.61 14.15 14.8… |
| prod large client nav warm projects->work-items @1440 no throttle | click -> ready | 7,158 | 8,109 | 5 | prefetched before click 5/5; nav RSC 46 ms / 29 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 33 ms in 5/5; main thread busy after ready 0 ms; load 11.61 14.15 14.83… |
| prod large client nav warm work-items->cycles @1440 no throttle | click -> ready | 161 | 176 | 5 | prefetched before click 5/5; nav RSC 37 ms / 6 KB (1 req); long tasks click->ready 72 ms; skeleton shown at 121 ms in 5/5; main thread busy after ready 747 ms; load 11.61 14.15 14… |
| prod large client nav warm cycles->inbox @1440 no throttle | click -> ready | 75 | 77 | 5 | prefetched before click 5/5; nav RSC 10 ms / 4 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 66 ms in 5/5; main thread busy after ready 753 ms; load 11.61 14.15 14.8… |
| prod large client nav warm inbox->analytics @1440 no throttle | click -> ready | 448 | 467 | 5 | prefetched before click 5/5; nav RSC 107 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 119 ms in 5/5; main thread busy after ready 786 ms; load 11.61 14.15 14… |
| prod large client nav warm analytics->home @1440 no throttle | click -> ready | 401 | 487 | 5 | prefetched before click 0/5; nav RSC 350 ms / 6 KB (1 req); long tasks click->ready 82 ms; skeleton shown at 107 ms in 5/5; main thread busy after ready 0 ms; load 11.61 14.15 14.… |
| prod large client nav cold home->projects @1440 CPU 4x | click -> ready | 132 | 151 | 5 | prefetched before click 5/5; nav RSC 18 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 113 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.70 … |
| prod large client nav cold projects->work-items @1440 CPU 4x | click -> ready | 28,798 | 31,450 | 5 | prefetched before click 5/5; nav RSC 68 ms / 29 KB (1 req); long tasks click->ready 218 ms; skeleton shown at 121 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.… |
| prod large client nav cold work-items->cycles @1440 CPU 4x | click -> ready | 1,026 | 1,288 | 5 | prefetched before click 5/5; nav RSC 36 ms / 6 KB (1 req); long tasks click->ready 486 ms; skeleton shown at 721 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.7… |
| prod large client nav cold cycles->inbox @1440 CPU 4x | click -> ready | 466 | 692 | 5 | prefetched before click 5/5; nav RSC 15 ms / 4 KB (1 req); long tasks click->ready 218 ms; skeleton shown at 426 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.7… |
| prod large client nav cold inbox->analytics @1440 CPU 4x | click -> ready | 1,191 | 1,367 | 5 | prefetched before click 5/5; nav RSC 90.5 ms / 5 KB (1 req); long tasks click->ready 101 ms; skeleton shown at null ms in 0/5; main thread busy after ready 0 ms; load 8.54 10.49 1… |
| prod large client nav cold analytics->home @1440 CPU 4x | click -> ready | 676 | 866 | 5 | prefetched before click 0/5; nav RSC 409 ms / 6 KB (1 req); long tasks click->ready 385 ms; skeleton shown at 627 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.… |
| prod large client nav warm home->projects @1440 CPU 4x | click -> ready | 91 | 102 | 5 | prefetched before click 5/5; nav RSC 22 ms / 5 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 74 ms in 4/5; main thread busy after ready 0 ms; load 8.54 10.49 12.70 -… |
| prod large client nav warm projects->work-items @1440 CPU 4x | click -> ready | 31,667 | 36,162 | 5 | prefetched before click 5/5; nav RSC 62 ms / 29 KB (1 req); long tasks click->ready 0 ms; skeleton shown at 72 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.70 … |
| prod large client nav warm work-items->cycles @1440 CPU 4x | click -> ready | 938 | 1,529 | 5 | prefetched before click 5/5; nav RSC 39 ms / 6 KB (1 req); long tasks click->ready 433 ms; skeleton shown at 760 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.7… |
| prod large client nav warm cycles->inbox @1440 CPU 4x | click -> ready | 412 | 493 | 5 | prefetched before click 5/5; nav RSC 16 ms / 4 KB (1 req); long tasks click->ready 103 ms; skeleton shown at 370 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.7… |
| prod large client nav warm inbox->analytics @1440 CPU 4x | click -> ready | 941 | 1,287 | 5 | prefetched before click 5/5; nav RSC 162 ms / 5 KB (1 req); long tasks click->ready 201 ms; skeleton shown at 715 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.… |
| prod large client nav warm analytics->home @1440 CPU 4x | click -> ready | 647 | 771 | 5 | prefetched before click 0/5; nav RSC 423 ms / 6 KB (1 req); long tasks click->ready 348 ms; skeleton shown at 612 ms in 5/5; main thread busy after ready 0 ms; load 8.54 10.49 12.… |
| prod large interaction peekOpen @1440 no throttle | input -> visible result | 3,028 | 3,092 | 5 | rsc_ms 45, rsc_kb 23.5, busy_after 0; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction stateDropdownOpen @1440 no throttle | input -> visible result | 162 | 291 | 5 | ; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction stateChange @1440 no throttle | input -> visible result | 379 | 480 | 5 | action_ms 492, busy_after 1142; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction boardMove @1440 no throttle | input -> visible result | 228 | 289 | 5 | action_ms 547, busy_after 199; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction quickAdd @1440 no throttle | input -> visible result | 1,033 | 1,159 | 5 | action_ms 1053, busy_after 951; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction powerKOpen @1440 no throttle | input -> visible result | 130 | 151 | 5 | source interactions-large-none-powerk.json; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddListSettleMs":0}; load 14.82 12.94 12.96 -> 15.28 14.06 13.42 |
| prod large interaction powerKSearch @1440 no throttle | input -> visible result | 322 | 421 | 5 | typing_ms 77, after_last_key_ms 174, search_api_ms 11.5, source interactions-large-none-powerk.json; setup {"listSettleMs":0,"stateListSettleMs":0,"boardSettleMs":626,"quickAddLis… |
| prod large interaction peekOpen @1440 CPU 4x | input -> visible result | 14,110 | 18,453 | 5 | rsc_ms 29, rsc_kb 24, busy_after 0; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction stateDropdownOpen @1440 CPU 4x | input -> visible result | 545 | 1,110 | 5 | ; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction stateChange @1440 CPU 4x | input -> visible result | 1,468 | 1,541 | 5 | action_ms 1869, busy_after 140; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction boardMove @1440 CPU 4x | input -> visible result | 702 | 737 | 5 | action_ms 898, busy_after 997; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction quickAdd @1440 CPU 4x | input -> visible result | 3,744 | 3,819 | 5 | action_ms 3802, busy_after 0; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction powerKOpen @1440 CPU 4x | input -> visible result | 540 | 565 | 5 | ; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44 -> 4.01 7.86 10.66 |
| prod large interaction powerKSearch @1440 CPU 4x | input -> visible result | 1,457 | 1,638 | 5 | typing_ms 1246, after_last_key_ms 211, search_api_ms 4.5; setup {"listSettleMs":180,"stateListSettleMs":3044,"boardSettleMs":0,"quickAddListSettleMs":2750}; load 14.44 13.98 13.44… |
| prod large perf spec list (decision 115) | navigation start -> [data-list-ready], 20 runs | 11,660 | 13,272 | 20 | budget p95 <= 300 ms; max 13629 |
| prod large perf spec board (decision 115) | navigation start -> [data-list-ready], 20 runs | 303 | 344 | 20 | budget p95 <= 300 ms; max 1091 |
| prod large perf spec table (decision 115) | navigation start -> [data-list-ready], 20 runs | 27,543 | 35,717 | 20 | budget p95 <= 300 ms; max 35858 |
| prod large hard load wi-list normal @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 6,574 |  | 5 | TTFB 4, response end 208, FCP 200 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-list chunks blocked @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 586 |  | 5 | TTFB 3, response end 191, FCP 188 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-list-state normal @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 8,563 |  | 5 | TTFB 3, response end 215, FCP 208 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-list-state chunks blocked @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 635 |  | 5 | TTFB 3, response end 231, FCP 228 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-board-state normal @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 1,245 |  | 5 | TTFB 2, response end 97, FCP 112 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.07… |
| prod large hard load wi-board-state chunks blocked @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 466 |  | 5 | TTFB 3, response end 102, FCP 116 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-table-state normal @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 23,073 |  | 5 | TTFB 2, response end 307, FCP 272 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |
| prod large hard load wi-table-state chunks blocked @1440 no throttle (warm cache) | navigation start -> [data-list-ready] visible, no skeleton | 796 |  | 5 | TTFB 3, response end 340, FCP 344 ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load 14.45 10.30 7.90 -> 5.0… |

#### prod bundle (67 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| prod bundle /projects/[projectId]/cycles/[cycleId] | first-load JS gzip KB (value is KB, not ms) | 1,081 |  | 1 | 3564 KB raw in 51 chunks |
| prod bundle /projects/[projectId]/modules/[moduleId] | first-load JS gzip KB (value is KB, not ms) | 973 |  | 1 | 3201 KB raw in 49 chunks |
| prod bundle /projects/[projectId]/views/[viewId] | first-load JS gzip KB (value is KB, not ms) | 962 |  | 1 | 3171 KB raw in 48 chunks |
| prod bundle /projects/[projectId]/archives/work-items | first-load JS gzip KB (value is KB, not ms) | 961 |  | 1 | 3168 KB raw in 49 chunks |
| prod bundle /projects/[projectId]/work-items | first-load JS gzip KB (value is KB, not ms) | 960 |  | 1 | 3164 KB raw in 48 chunks |
| prod bundle /projects/[projectId]/intake | first-load JS gzip KB (value is KB, not ms) | 898 |  | 1 | 2966 KB raw in 48 chunks |
| prod bundle /inbox | first-load JS gzip KB (value is KB, not ms) | 891 |  | 1 | 2947 KB raw in 45 chunks |
| prod bundle /projects/[projectId]/work-items/[workItemId] | first-load JS gzip KB (value is KB, not ms) | 878 |  | 1 | 2905 KB raw in 46 chunks |
| prod bundle /work-items/[workItemId] | first-load JS gzip KB (value is KB, not ms) | 874 |  | 1 | 2895 KB raw in 44 chunks |
| prod bundle /projects/[projectId]/pages/[pageId] | first-load JS gzip KB (value is KB, not ms) | 869 |  | 1 | 2875 KB raw in 46 chunks |
| prod bundle /pages/[pageId] | first-load JS gzip KB (value is KB, not ms) | 864 |  | 1 | 2863 KB raw in 44 chunks |
| prod bundle /stickies | first-load JS gzip KB (value is KB, not ms) | 819 |  | 1 | 2731 KB raw in 39 chunks |
| prod bundle /projects/[projectId]/cycles | first-load JS gzip KB (value is KB, not ms) | 704 |  | 1 | 2325 KB raw in 45 chunks |
| prod bundle /active-cycles | first-load JS gzip KB (value is KB, not ms) | 696 |  | 1 | 2305 KB raw in 43 chunks |
| prod bundle /analytics/[tab] | first-load JS gzip KB (value is KB, not ms) | 685 |  | 1 | 2272 KB raw in 42 chunks |
| prod bundle /agents/[actorId]/[tab] | first-load JS gzip KB (value is KB, not ms) | 665 |  | 1 | 2190 KB raw in 43 chunks |
| prod bundle /your-work/[tab] | first-load JS gzip KB (value is KB, not ms) | 665 |  | 1 | 2190 KB raw in 43 chunks |
| prod bundle /workspace-views/[viewId] | first-load JS gzip KB (value is KB, not ms) | 659 |  | 1 | 2171 KB raw in 43 chunks |
| prod bundle /projects/[projectId]/pages | first-load JS gzip KB (value is KB, not ms) | 596 |  | 1 | 1962 KB raw in 44 chunks |
| prod bundle /wiki | first-load JS gzip KB (value is KB, not ms) | 591 |  | 1 | 1950 KB raw in 42 chunks |
| prod bundle /projects/[projectId]/modules | first-load JS gzip KB (value is KB, not ms) | 590 |  | 1 | 1947 KB raw in 43 chunks |
| prod bundle / | first-load JS gzip KB (value is KB, not ms) | 589 |  | 1 | 1945 KB raw in 42 chunks |
| prod bundle /projects/[projectId]/settings/states | first-load JS gzip KB (value is KB, not ms) | 582 |  | 1 | 1926 KB raw in 43 chunks |
| prod bundle /drafts | first-load JS gzip KB (value is KB, not ms) | 578 |  | 1 | 1915 KB raw in 41 chunks |
| prod bundle /projects/[projectId]/settings/estimates | first-load JS gzip KB (value is KB, not ms) | 554 |  | 1 | 1837 KB raw in 42 chunks |
| prod bundle /projects/[projectId]/views | first-load JS gzip KB (value is KB, not ms) | 553 |  | 1 | 1836 KB raw in 40 chunks |
| prod bundle /projects/[projectId]/settings/agents | first-load JS gzip KB (value is KB, not ms) | 551 |  | 1 | 1831 KB raw in 41 chunks |
| prod bundle /projects/[projectId]/archives/modules | first-load JS gzip KB (value is KB, not ms) | 552 |  | 1 | 1830 KB raw in 41 chunks |
| prod bundle /projects/[projectId]/archives/cycles | first-load JS gzip KB (value is KB, not ms) | 551 |  | 1 | 1830 KB raw in 41 chunks |
| prod bundle /projects/[projectId]/settings/automations | first-load JS gzip KB (value is KB, not ms) | 550 |  | 1 | 1828 KB raw in 41 chunks |
| prod bundle /projects/[projectId]/settings/labels | first-load JS gzip KB (value is KB, not ms) | 550 |  | 1 | 1827 KB raw in 41 chunks |
| prod bundle /settings/webhooks/[webhookId] | first-load JS gzip KB (value is KB, not ms) | 549 |  | 1 | 1826 KB raw in 39 chunks |
| prod bundle /projects | first-load JS gzip KB (value is KB, not ms) | 548 |  | 1 | 1823 KB raw in 39 chunks |
| prod bundle /projects/archives | first-load JS gzip KB (value is KB, not ms) | 548 |  | 1 | 1823 KB raw in 39 chunks |
| prod bundle /workspace-views | first-load JS gzip KB (value is KB, not ms) | 547 |  | 1 | 1821 KB raw in 38 chunks |
| prod bundle /projects/[projectId]/settings/general | first-load JS gzip KB (value is KB, not ms) | 547 |  | 1 | 1820 KB raw in 41 chunks |
| prod bundle /settings/exports | first-load JS gzip KB (value is KB, not ms) | 547 |  | 1 | 1818 KB raw in 38 chunks |
| prod bundle /projects/[projectId]/settings/features | first-load JS gzip KB (value is KB, not ms) | 547 |  | 1 | 1817 KB raw in 41 chunks |
| prod bundle /settings/backups | first-load JS gzip KB (value is KB, not ms) | 546 |  | 1 | 1817 KB raw in 38 chunks |
| prod bundle /projects/[projectId]/settings | first-load JS gzip KB (value is KB, not ms) | 545 |  | 1 | 1815 KB raw in 40 chunks |
| prod bundle /projects/[projectId]/archives | first-load JS gzip KB (value is KB, not ms) | 545 |  | 1 | 1815 KB raw in 40 chunks |
| prod bundle /projects/[projectId] | first-load JS gzip KB (value is KB, not ms) | 545 |  | 1 | 1814 KB raw in 39 chunks |
| prod bundle /agents | first-load JS gzip KB (value is KB, not ms) | 545 |  | 1 | 1814 KB raw in 38 chunks |
| prod bundle /settings/webhooks | first-load JS gzip KB (value is KB, not ms) | 544 |  | 1 | 1813 KB raw in 38 chunks |
| prod bundle /settings/[tab] | first-load JS gzip KB (value is KB, not ms) | 542 |  | 1 | 1808 KB raw in 38 chunks |
| prod bundle /agents/[actorId] | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /analytics | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /browse/[key] | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /cycles/[cycleId] | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /modules/[moduleId] | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /settings | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /your-work | first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle /_not-found | first-load JS gzip KB (value is KB, not ms) | 277 |  | 1 | 1022 KB raw in 16 chunks |
| prod bundle shared by every route | shared first-load JS gzip KB (value is KB, not ms) | 541 |  | 1 | 1803 KB raw in 37 chunks |
| prod bundle CSS total | CSS gzip KB (value is KB, not ms) | 52 |  | 1 | 295 KB raw in 9 files; all JS 4644 KB raw in 111 files |
| prod bundle chunk 0r3mtv5jjeqon.js | chunk gzip KB (value is KB, not ms) | 269 |  | 1 | 903 KB raw; first load of 12 routes; holds @tiptap, prosemirror, lowlight/highlight.js, markdown-it/marked, tessera app code |
| prod bundle chunk 27kj2s3cuwvcq.js | chunk gzip KB (value is KB, not ms) | 76 |  | 1 | 350 KB raw; first load of 53 routes; holds see hotspots |
| prod bundle chunk 1_0y4ztv7ticn.js | chunk gzip KB (value is KB, not ms) | 103 |  | 1 | 348 KB raw; first load of 4 routes; holds recharts, d3 (recharts) |
| prod bundle chunk 0i8eef_83jjb7.js | chunk gzip KB (value is KB, not ms) | 64 |  | 1 | 202 KB raw; first load of 53 routes; holds react-dom |
| prod bundle chunk 1bgu118fh_96w.js | chunk gzip KB (value is KB, not ms) | 60 |  | 1 | 198 KB raw; first load of 8 routes; holds uuid, tessera app code |
| prod bundle chunk 159h5br6-lj5s.js | chunk gzip KB (value is KB, not ms) | 40 |  | 1 | 132 KB raw; first load of 52 routes; holds @astryxdesign/core, tessera app code |
| prod bundle chunk 1gsjhro5fzrji.js | chunk gzip KB (value is KB, not ms) | 35 |  | 1 | 129 KB raw; first load of 53 routes; holds next router |
| prod bundle chunk 2rqlly34-6q9v.js | chunk gzip KB (value is KB, not ms) | 37 |  | 1 | 128 KB raw; first load of 52 routes; holds zod, uuid |
| prod bundle chunk 3xkodhg22bplv.js | chunk gzip KB (value is KB, not ms) | 43 |  | 1 | 125 KB raw; first load of 52 routes; holds @astryxdesign/core |
| prod bundle chunk 0cz1d0mv5g_q7.js | chunk gzip KB (value is KB, not ms) | 39 |  | 1 | 110 KB raw; first load of 0 routes; holds see hotspots |
| prod bundle chunk 1x-ecp8rc9s-3.js | chunk gzip KB (value is KB, not ms) | 22 |  | 1 | 75 KB raw; first load of 53 routes; holds @astryxdesign/core |
| prod bundle chunk 0pzdergpjwhh2.js | chunk gzip KB (value is KB, not ms) | 21 |  | 1 | 66 KB raw; first load of 22 routes; holds @astryxdesign/core, tessera app code |

#### engine perf:bench (26 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| engine perf:bench list first page, ungrouped (limit 200) (bench-2.txt) | engine call time, best of 3x50 runs | 3.3 | 3.9 | 150 | budget 40 ms (decision 115): ok; max 4.1 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench list first page, grouped by state (first page) (bench-2.txt) | engine call time, best of 3x50 runs | 14.2 | 16.4 | 150 | budget 40 ms (decision 115): ok; max 18.9 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench list first page, workspace scope (limit 200) (bench-2.txt) | engine call time, best of 3x50 runs | 3.6 | 4.1 | 150 | budget 40 ms (decision 115): ok; max 4.3 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench board first page, by state (first page) (bench-2.txt) | engine call time, best of 3x50 runs | 12.3 | 13.4 | 150 | budget 40 ms (decision 115): ok; max 16.7 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench group projection, by priority (bench-2.txt) | engine call time, best of 3x50 runs | 13 | 14.7 | 150 | budget 40 ms (decision 115): ok; max 18.8 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench group projection, by labels (bench-2.txt) | engine call time, best of 3x50 runs | 23.7 | 26.9 | 150 | budget 40 ms (decision 115): ok; max 32.0 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench group projection, by assignees (bench-2.txt) | engine call time, best of 3x50 runs | 17.4 | 21.1 | 150 | budget 40 ms (decision 115): ok; max 21.8 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench group projection, by modules (bench-2.txt) | engine call time, best of 3x50 runs | 18.5 | 19.7 | 150 | budget 40 ms (decision 115): ok; max 19.9 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench getCounts, project (bench-2.txt) | engine call time, best of 3x50 runs | 17.2 | 18 | 150 | budget 25 ms (decision 115): ok; max 27.5 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench getCounts, workspace (bench-2.txt) | engine call time, best of 3x50 runs | 19.4 | 20.1 | 150 | budget 25 ms (decision 115): ok; max 26.5 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench analytics overview, 30d (bench-2.txt) | engine call time, best of 3x50 runs | 43.4 | 44.9 | 150 | budget 60 ms (decision 115): ok; max 45.7 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench search (rotating terms) (bench-2.txt) | engine call time, best of 3x50 runs | 0.9 | 1.7 | 150 | budget 30 ms (decision 115): ok; max 1.8 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench detail read (rotating items) (bench-2.txt) | engine call time, best of 3x50 runs | 0.3 | 0.4 | 150 | budget 25 ms (decision 115): ok; max 0.8 ms; perf-spec.db (10000 PERF items); load 4.01 7.73 10.58 -> 4.53 7.50 10.40 |
| engine perf:bench list first page, ungrouped (limit 200) (bench.txt) | engine call time, best of 3x50 runs | 3.5 | 3.9 | 150 | budget 40 ms (decision 115): ok; max 4.8 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench list first page, grouped by state (first page) (bench.txt) | engine call time, best of 3x50 runs | 14 | 17.5 | 150 | budget 40 ms (decision 115): ok; max 27.6 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench list first page, workspace scope (limit 200) (bench.txt) | engine call time, best of 3x50 runs | 4 | 6.5 | 150 | budget 40 ms (decision 115): ok; max 32.4 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench board first page, by state (first page) (bench.txt) | engine call time, best of 3x50 runs | 12.8 | 19.3 | 150 | budget 40 ms (decision 115): ok; max 29.8 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench group projection, by priority (bench.txt) | engine call time, best of 3x50 runs | 14.6 | 18.4 | 150 | budget 40 ms (decision 115): ok; max 20.7 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench group projection, by labels (bench.txt) | engine call time, best of 3x50 runs | 24.9 | 34.1 | 150 | budget 40 ms (decision 115): ok; max 44.2 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench group projection, by assignees (bench.txt) | engine call time, best of 3x50 runs | 18.2 | 22.3 | 150 | budget 40 ms (decision 115): ok; max 68.0 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench group projection, by modules (bench.txt) | engine call time, best of 3x50 runs | 19.1 | 23.6 | 150 | budget 40 ms (decision 115): ok; max 36.1 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench getCounts, project (bench.txt) | engine call time, best of 3x50 runs | 19.3 | 22.6 | 150 | budget 25 ms (decision 115): ok; max 63.7 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench getCounts, workspace (bench.txt) | engine call time, best of 3x50 runs | 20.4 | 31.5 | 150 | budget 25 ms (decision 115): OVER; max 56.8 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench analytics overview, 30d (bench.txt) | engine call time, best of 3x50 runs | 50.8 | 64.3 | 150 | budget 60 ms (decision 115): OVER; max 83.4 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench search (rotating terms) (bench.txt) | engine call time, best of 3x50 runs | 1 | 1.9 | 150 | budget 30 ms (decision 115): ok; max 3.7 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |
| engine perf:bench detail read (rotating items) (bench.txt) | engine call time, best of 3x50 runs | 0.4 | 0.7 | 150 | budget 25 ms (decision 115): ok; max 1.0 ms; perf-spec.db (10000 PERF items); load 14.37 8.84 8.20 -> 22.64 11.31 9.12 |

### A2. Development server (dev-metrics-compact.json, 123 rows)

#### a/b dev (29 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| a/b dev cold start SMALL | process spawn to 'Ready' line (wall) | 383 | 394 | 5 | Next prints 'Ready in' 233 ms; rm -rf .next/dev first; very first start of the copy also logged 'Running next.config.ts took 1273ms' on the first request (later starts 15-19 ms); … |
| a/b dev warm start SMALL | process spawn to 'Ready' line (wall) | 388 | 395 | 5 | Next prints 'Ready in' 238 ms; .next/dev kept; very first start of the copy also logged 'Running next.config.ts took 1273ms' on the first request (later starts 15-19 ms); loads 3.… |
| a/b dev cold first visits SMALL | sum of 25 first-visit full loads (goto -> ready), user order | 29,511 | 30,196 | 5 | per-run sums 29550, 30196, 29511, 26660, 28673; generate-params sum 4129 ms; loads 3.19 3.06 3.59 \| 3.44 3.17 3.58 \| 5.09 3.69 3.74 \| 4.28 3.80 3.77 \| 4.15 3.81 3.77 |
| a/b dev warm first visits SMALL | sum of 25 first-visit full loads (goto -> ready), user order | 26,285 | 30,280 | 5 | per-run sums 26517, 26285, 30280, 25562, 24346; generate-params sum 4112 ms; loads 3.08 3.06 3.56 \| 3.98 3.35 3.63 \| 4.48 3.71 3.74 \| 3.91 3.74 3.75 \| 5.42 4.20 3.92 |
| a/b dev first visit SMALL home | cold start: full load goto -> ready | 3,492 | 3,513 | 5 | warm restart 1303 (p95 3462); cold docEnd 3071 = outside-log compile/load 2459 + log 606 (gp 0, app 463); warm outside-log 288, gp 0 |
| a/b dev first visit SMALL projects | cold start: full load goto -> ready | 565 | 594 | 5 | warm restart 173 (p95 556); cold docEnd 493 = outside-log compile/load 398 + log 94 (gp 0, app 89); warm outside-log 17, gp 0 |
| a/b dev first visit SMALL wi-list | cold start: full load goto -> ready | 2,814 | 2,888 | 5 | warm restart 2210 (p95 2901); cold docEnd 1587 = outside-log compile/load 837 + log 744 (gp 340, app 398); warm outside-log 86, gp 338 |
| a/b dev first visit SMALL wi-board | cold start: full load goto -> ready | 670 | 672 | 5 | warm restart 643 (p95 660); cold docEnd 218 = outside-log compile/load 28 + log 190 (gp 2, app 188); warm outside-log 5, gp 1 |
| a/b dev first visit SMALL wi-table | cold start: full load goto -> ready | 2,455 | 2,564 | 5 | warm restart 2289 (p95 2445); cold docEnd 179 = outside-log compile/load 7 + log 172 (gp 2, app 169); warm outside-log 7, gp 3 |
| a/b dev first visit SMALL wi-peek | cold start: full load goto -> ready | 1,921 | 2,058 | 5 | warm restart 1852 (p95 1954); cold docEnd 286 = outside-log compile/load 3 + log 253 (gp 1, app 252); warm outside-log 3, gp 1 |
| a/b dev first visit SMALL work-item | cold start: full load goto -> ready | 1,425 | 1,436 | 5 | warm restart 1351 (p95 1372); cold docEnd 1048 = outside-log compile/load 532 + log 498 (gp 348, app 148); warm outside-log 476, gp 336 |
| a/b dev first visit SMALL cycles | cold start: full load goto -> ready | 1,529 | 1,559 | 5 | warm restart 1480 (p95 1535); cold docEnd 1144 = outside-log compile/load 644 + log 504 (gp 341, app 160); warm outside-log 650, gp 336 |
| a/b dev first visit SMALL cycle | cold start: full load goto -> ready | 1,748 | 1,905 | 5 | warm restart 1767 (p95 1784); cold docEnd 1154 = outside-log compile/load 560 + log 600 (gp 341, app 252); warm outside-log 579, gp 342 |
| a/b dev first visit SMALL modules | cold start: full load goto -> ready | 977 | 984 | 5 | warm restart 961 (p95 1031); cold docEnd 734 = outside-log compile/load 286 + log 447 (gp 342, app 103); warm outside-log 282, gp 336 |
| a/b dev first visit SMALL views | cold start: full load goto -> ready | 958 | 959 | 5 | warm restart 961 (p95 985); cold docEnd 707 = outside-log compile/load 270 + log 437 (gp 339, app 93); warm outside-log 282, gp 339 |
| a/b dev first visit SMALL pages | cold start: full load goto -> ready | 1,000 | 1,053 | 5 | warm restart 996 (p95 1204); cold docEnd 745 = outside-log compile/load 285 + log 458 (gp 337, app 117); warm outside-log 278, gp 338 |
| a/b dev first visit SMALL page | cold start: full load goto -> ready | 1,113 | 1,124 | 5 | warm restart 1102 (p95 1231); cold docEnd 788 = outside-log compile/load 336 + log 449 (gp 343, app 104); warm outside-log 329, gp 340 |
| a/b dev first visit SMALL intake | cold start: full load goto -> ready | 1,205 | 1,209 | 5 | warm restart 1202 (p95 1217); cold docEnd 839 = outside-log compile/load 385 + log 450 (gp 342, app 104); warm outside-log 367, gp 348 |
| a/b dev first visit SMALL inbox | cold start: full load goto -> ready | 701 | 721 | 5 | warm restart 671 (p95 733); cold docEnd 437 = outside-log compile/load 339 + log 98 (gp 0, app 94); warm outside-log 311, gp 0 |
| a/b dev first visit SMALL yw-summary | cold start: full load goto -> ready | 1,191 | 1,199 | 5 | warm restart 1097 (p95 1217); cold docEnd 809 = outside-log compile/load 340 + log 463 (gp 352, app 101); warm outside-log 337, gp 351 |
| a/b dev first visit SMALL yw-assigned | cold start: full load goto -> ready | 752 | 767 | 5 | warm restart 753 (p95 767); cold docEnd 193 = outside-log compile/load 27 + log 163 (gp 1, app 161); warm outside-log 29, gp 2 |
| a/b dev first visit SMALL agents | cold start: full load goto -> ready | 548 | 553 | 5 | warm restart 554 (p95 563); cold docEnd 324 = outside-log compile/load 251 + log 76 (gp 0, app 72); warm outside-log 251, gp 0 |
| a/b dev first visit SMALL drafts | cold start: full load goto -> ready | 401 | 418 | 5 | warm restart 414 (p95 426); cold docEnd 358 = outside-log compile/load 278 + log 80 (gp 0, app 76); warm outside-log 287, gp 0 |
| a/b dev first visit SMALL workspace-views | cold start: full load goto -> ready | 406 | 609 | 5 | warm restart 404 (p95 411); cold docEnd 361 = outside-log compile/load 286 + log 75 (gp 0, app 72); warm outside-log 281, gp 0 |
| a/b dev first visit SMALL active-cycles | cold start: full load goto -> ready | 736 | 765 | 5 | warm restart 723 (p95 735); cold docEnd 468 = outside-log compile/load 383 + log 80 (gp 0, app 76); warm outside-log 372, gp 0 |
| a/b dev first visit SMALL analytics | cold start: full load goto -> ready | 1,319 | 1,335 | 5 | warm restart 1327 (p95 1352); cold docEnd 899 = outside-log compile/load 412 + log 487 (gp 351, app 130); warm outside-log 415, gp 355 |
| a/b dev first visit SMALL stickies | cold start: full load goto -> ready | 732 | 786 | 5 | warm restart 723 (p95 775); cold docEnd 434 = outside-log compile/load 325 + log 108 (gp 0, app 105); warm outside-log 315, gp 0 |
| a/b dev first visit SMALL wiki | cold start: full load goto -> ready | 751 | 769 | 5 | warm restart 759 (p95 787); cold docEnd 456 = outside-log compile/load 331 + log 127 (gp 0, app 123); warm outside-log 330, gp 0 |
| a/b dev first visit SMALL settings | cold start: full load goto -> ready | 778 | 790 | 5 | warm restart 759 (p95 794); cold docEnd 735 = outside-log compile/load 317 + log 419 (gp 343, app 71); warm outside-log 295, gp 343 |

#### d nav (20 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| d nav SMALL 1440 no-throttle dev home->projects | click -> ready | 138 | 143 | 5 | RSC fetch start 5, first byte 21, end 28 ms after click; client after RSC 110; long tasks 0 (max 0); dev-log server 19; prefetches done before click 0; dev/prod interleaved, round… |
| d nav SMALL 1440 no-throttle dev projects->work-items | click -> ready | 1,338 | 1,370 | 5 | RSC fetch start 3, first byte 24, end 38 ms after click; client after RSC 1300; long tasks 1052 (max 1052); dev-log server 29; prefetches done before click 0; dev/prod interleaved… |
| d nav SMALL 1440 no-throttle dev work-items->cycles | click -> ready | 245 | 257 | 5 | RSC fetch start 4, first byte 24, end 35 ms after click; client after RSC 210; long tasks 83 (max 83); dev-log server 26; prefetches done before click 0; dev/prod interleaved, rou… |
| d nav SMALL 1440 no-throttle dev cycles->inbox | click -> ready | 191 | 224 | 5 | RSC fetch start 3, first byte 21, end 30 ms after click; client after RSC 161; long tasks 61 (max 61); dev-log server 21; prefetches done before click 0; dev/prod interleaved, rou… |
| d nav SMALL 1440 no-throttle dev inbox->analytics | click -> ready | 595 | 615 | 5 | RSC fetch start 2, first byte 19, end 204 ms after click; client after RSC 389; long tasks 61 (max 61); dev-log server 73; prefetches done before click 0; dev/prod interleaved, ro… |
| d nav SMALL 1440 no-throttle dev analytics->home | click -> ready | 164 | 200 | 5 | RSC fetch start 2, first byte 18, end 29 ms after click; client after RSC 135; long tasks 59 (max 59); dev-log server 22; prefetches done before click 0; dev/prod interleaved, rou… |
| d nav SMALL 1440 no-throttle dev prefetch requests per round | prefetch requests seen per round (CDP Network) | 0 |  | 5 | dev: none (docs: prefetching is production-only); prod: viewport prefetches incl. segment prefetches |
| d nav SMALL 1440 no-throttle prod home->projects | click -> ready | 58 | 66 | 5 | RSC fetch start 3, first byte 9, end 19 ms after click; client after RSC 39; long tasks 0 (max 0);  prefetches done before click 7; dev/prod interleaved, round loads 5.32,6.03,8.2… |
| d nav SMALL 1440 no-throttle prod projects->work-items | click -> ready | 928 | 950 | 5 | RSC fetch start 2, first byte 15, end 18 ms after click; client after RSC 910; long tasks 555 (max 555);  prefetches done before click 2; dev/prod interleaved, round loads 5.32,6.… |
| d nav SMALL 1440 no-throttle prod work-items->cycles | click -> ready | 387 | 388 | 5 | RSC fetch start 3, first byte 11, end 16 ms after click; client after RSC 370; long tasks 0 (max 0);  prefetches done before click 4; dev/prod interleaved, round loads 5.32,6.03,8… |
| d nav SMALL 1440 no-throttle prod cycles->inbox | click -> ready | 349 | 366 | 5 | RSC fetch start 2, first byte 8, end 12 ms after click; client after RSC 337; long tasks 0 (max 0);  prefetches done before click 2; dev/prod interleaved, round loads 5.32,6.03,8.… |
| d nav SMALL 1440 no-throttle prod inbox->analytics | click -> ready | 428 | 446 | 5 | RSC fetch start 47, first byte 56, end 60 ms after click; client after RSC 368; long tasks 0 (max 0);  prefetches done before click 2; dev/prod interleaved, round loads 5.32,6.03,… |
| d nav SMALL 1440 no-throttle prod analytics->home | click -> ready | 57 | 72 | 5 | RSC fetch start 1, first byte 11, end 15 ms after click; client after RSC 42; long tasks 0 (max 0);  prefetches done before click 0; dev/prod interleaved, round loads 5.32,6.03,8.… |
| d nav SMALL 1440 no-throttle prod prefetch requests per round | prefetch requests seen per round (CDP Network) | 45 |  | 5 | dev: none (docs: prefetching is production-only); prod: viewport prefetches incl. segment prefetches |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 home->projects | click -> ready | 66 | 66 | 5 | same-time unpatched prod 66; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 projects->work-items | click -> ready | 676 | 688 | 5 | same-time unpatched prod 928; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 work-items->cycles | click -> ready | 101 | 104 | 5 | same-time unpatched prod 370; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 cycles->inbox | click -> ready | 63 | 64 | 5 | same-time unpatched prod 355; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 inbox->analytics | click -> ready | 118 | 120 | 5 | same-time unpatched prod 423; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |
| d nav SMALL prod with React FALLBACK_THROTTLE_MS patched to 0 analytics->home | click -> ready | 57 | 71 | 5 | same-time unpatched prod 56; experiment only (chunk rewritten in the browser), interleaved; loads 8.10,6.09,5.71,5.62,4.54 |

#### e HMR (5 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| e HMR SMALL edit shell component src/components/shell/TesseraShell.tsx | server 'Compiled in' | 24 | 117 | 5 | full reloads 5/5; write -> '[Fast Refresh] rebuilding' 41 ms; write -> '[Fast Refresh] done' 217; loads 5.72 4.82 4.23 -> 5.06 4.73 4.21 |
| e HMR SMALL edit work-items component src/components/work-items/ListLayout.tsx | server 'Compiled in' | 13 | 55 | 5 | full reloads 0/5; write -> '[Fast Refresh] rebuilding' 51 ms; write -> '[Fast Refresh] done' 581; loads 4.75 4.68 4.20 -> 3.85 4.48 4.14 |
| e HMR SMALL edit shell component src/components/shell/TopBar.tsx (HEAD) | server 'Compiled in' | 11 |  | 3 | full reloads 0/3; write -> '[Fast Refresh] done' 70; loads 3.13 3.41 4.72 -> 3.34 3.44 4.71 |
| e HMR SMALL edit shell component src/components/shell/Sidebar.tsx (HEAD) | server 'Compiled in' | 19 |  | 3 | full reloads 3/3; write -> '[Fast Refresh] done' n/a (full reload); loads 3.31 3.44 4.70 -> 3.00 3.37 4.65 |
| e HMR SMALL edit TesseraShell.tsx in a variant where ShellContext/useShell live in shell-context.ts | server 'Compiled in' | 13 |  | 5 | full reloads 0/5; write -> '[Fast Refresh] done' 128; reported done-in 3; loads 3.83 3.54 4.86 -> 3.52 3.49 4.81 |

#### f1 dev (2 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| f1 dev cold compile HEAD barrel import | cold first visit / + work items (sum of two full loads) | 5,298 | 6,518 | 5 | runs 6518, 6463, 5213, 5298, 5201; / 3383 (compile ~2370), work items 1853 (compile ~968); interleaved head/icons; dev phosphor client chunk identical in both (1,167,682 bytes, 13… |
| f1 dev cold compile per-icon deep imports (dev-icons) | cold first visit / + work items (sum of two full loads) | 5,282 | 8,030 | 5 | runs 8030, 5282, 5177, 5242, 5298; / 3426 (compile ~2401), work items 1819 (compile ~954); interleaved head/icons; dev phosphor client chunk identical in both (1,167,682 bytes, 13… |

#### LARGE full (12 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| LARGE full load dev home | goto -> ready | 710 | 876 | 5 | docEnd 351, FCP 380, long tasks 145, dev-log server 337; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod home | goto -> ready | 411 | 420 | 5 | docEnd 276, FCP 292, long tasks 0; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |
| LARGE full load dev wi-list | goto -> ready | 8,846 | 9,352 | 5 | docEnd 472, FCP 452, long tasks 8387, dev-log server 456; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod wi-list | goto -> ready | 6,456 | 6,524 | 5 | docEnd 199, FCP 76, long tasks 6265; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |
| LARGE full load dev wi-table | goto -> ready | 19,753 | 23,376 | 5 | docEnd 1328, FCP 1356, long tasks 18571, dev-log server 542; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod wi-table | goto -> ready | 15,168 | 15,417 | 5 | docEnd 245, FCP 156, long tasks 15023; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |
| LARGE full load dev wi-peek | goto -> ready | 13,670 | 14,941 | 5 | docEnd 1425, FCP 1468, long tasks 12149, dev-log server 506; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod wi-peek | goto -> ready | 7,721 | 7,810 | 5 | docEnd 470, FCP 516, long tasks 7229; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |
| LARGE full load dev cycle | goto -> ready | 12,955 | 13,280 | 5 | docEnd 1459, FCP 1508, long tasks 11322, dev-log server 533; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod cycle | goto -> ready | 6,607 | 7,349 | 5 | docEnd 395, FCP 448, long tasks 6113; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |
| LARGE full load dev yw-assigned | goto -> ready | 12,178 | 12,879 | 5 | docEnd 1266, FCP 1304, long tasks 10871, dev-log server 633; next dev of the same copy, interleaved; loads 5.83,4.79,12.17,5.53,4.51 |
| LARGE full load prod yw-assigned | goto -> ready | 6,167 | 7,330 | 5 | docEnd 370, FCP 348, long tasks 5831; next start of the same copy, interleaved; loads 4.17,13.67,7.87,4.95,6.41 |

#### f2 dev (3 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| f2 dev static-paths worker (generate-params), /your-work/[tab] | CPU busy per worker process (V8 --cpu-prof) | 346 | 354 | 6 | 6 worker profiles for 6 GET /your-work/summary: the first blocks the request (logged generate-params 363 ms), each later request forks one more in the background (logged generate-… |
| f2 dev /your-work/summary first visit | generate-params part of the dev-log line | 352 |  | 5 | cold runs; warm restart 351; steady 1.4; every dynamic route pays it once per server process: median 337-352 ms across the 13 dynamic routes, sum 4129 ms per 25-route session; sta… |
| f2 dev worker spawns during one client-nav round (Home->Projects->Work items->Cycles->Inbox->Analytics->Home) | static-paths worker processes started (count, not ms) | 4 |  | 1 | busy 363-382 ms each (load 28 at the time); one per dynamic-route request (work items, cycles, analytics redirect target...); results/dev-cpuprof-nav |

#### JS shipped (3 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| JS shipped full load / | uncompressed JS KB (value is KB, not ms): dev | 11,785 |  | 1 | prod 2869 KB (44 scripts) vs dev 38 scripts; biggest dev chunks: Astryx core dist 1.8 MB, react-dom development 1.0 MB, next client 0.9 MB, next-devtools 0.9 MB, src 0.8 MB, zod v… |
| JS shipped full load /inbox | uncompressed JS KB (value is KB, not ms): dev | 15,968 |  | 1 | prod 2998 KB (48 scripts) vs dev 46 scripts; biggest dev chunks: Astryx core dist 1.8 MB, react-dom development 1.0 MB, next client 0.9 MB, next-devtools 0.9 MB, src 0.8 MB, zod v… |
| JS shipped full load LARGE work items | uncompressed JS KB (value is KB, not ms): dev | 17,470 |  | 1 | prod 3140 KB (46 scripts) vs dev 55 scripts; biggest dev chunks: Astryx core dist 1.8 MB, react-dom development 1.0 MB, next client 0.9 MB, next-devtools 0.9 MB, src 0.8 MB, zod v… |

#### c dev (49 rows)

| Scenario | Metric | Median | p95 | n | Notes |
|---|---|---:|---:|---:|---|
| c dev steady SMALL home | dev-log server total (document) | 83 | 96 | 5 | app 82, gp 0; browser ready 363, long tasks 144 |
| c dev steady SMALL projects | dev-log server total (document) | 71 | 142 | 5 | app 70, gp 0; browser ready 334, long tasks 137 |
| c dev steady SMALL wi-list | dev-log server total (document) | 236 | 243 | 5 | app 234, gp 1.3; browser ready 1694, long tasks 1335 |
| c dev steady SMALL wi-board | dev-log server total (document) | 187 | 206 | 5 | app 186, gp 1.1; browser ready 347, long tasks 475 |
| c dev steady SMALL wi-table | dev-log server total (document) | 262 | 287 | 5 | app 261, gp 1.1; browser ready 2293, long tasks 1889 |
| c dev steady SMALL wi-peek | dev-log server total (document) | 250 | 255 | 5 | app 248, gp 1.1; browser ready 2113, long tasks 1758 |
| c dev steady SMALL work-item | dev-log server total (document) | 133 | 268 | 5 | app 129, gp 2; browser ready 504, long tasks 271 |
| c dev steady SMALL cycles | dev-log server total (document) | 96 | 173 | 5 | app 94, gp 1.1; browser ready 502, long tasks 233 |
| c dev steady SMALL cycle | dev-log server total (document) | 196 | 264 | 5 | app 195, gp 1.3; browser ready 957, long tasks 486 |
| c dev steady SMALL modules | dev-log server total (document) | 90 | 97 | 5 | app 89, gp 1.1; browser ready 166, long tasks 193 |
| c dev steady SMALL views | dev-log server total (document) | 92 | 94 | 5 | app 90, gp 1; browser ready 353, long tasks 149 |
| c dev steady SMALL pages | dev-log server total (document) | 107 | 109 | 5 | app 105, gp 1.1; browser ready 393, long tasks 158 |
| c dev steady SMALL page | dev-log server total (document) | 92 | 103 | 5 | app 90, gp 1.1; browser ready 376, long tasks 173 |
| c dev steady SMALL intake | dev-log server total (document) | 92 | 116 | 5 | app 90, gp 1.3; browser ready 369, long tasks 142 |
| c dev steady SMALL inbox | dev-log server total (document) | 80 | 83 | 5 | app 80, gp 0; browser ready 161, long tasks 174 |
| c dev steady SMALL yw-summary | dev-log server total (document) | 82 | 89 | 5 | app 80, gp 1.4; browser ready 158, long tasks 146 |
| c dev steady SMALL yw-assigned | dev-log server total (document) | 166 | 171 | 5 | app 163, gp 1.6; browser ready 232, long tasks 512 |
| c dev steady SMALL agents | dev-log server total (document) | 71 | 72 | 5 | app 70, gp 0; browser ready 320, long tasks 134 |
| c dev steady SMALL drafts | dev-log server total (document) | 68 | 73 | 5 | app 67, gp 0; browser ready 135, long tasks 134 |
| c dev steady SMALL workspace-views | dev-log server total (document) | 73 | 79 | 5 | app 72, gp 0; browser ready 139, long tasks 138 |
| c dev steady SMALL active-cycles | dev-log server total (document) | 73 | 79 | 5 | app 72, gp 0; browser ready 367, long tasks 163 |
| c dev steady SMALL analytics | dev-log server total (document) | 93 | 100 | 5 | app 91, gp 1.3; browser ready 462, long tasks 235 |
| c dev steady SMALL stickies | dev-log server total (document) | 92 | 99 | 5 | app 91, gp 0; browser ready 409, long tasks 194 |
| c dev steady SMALL wiki | dev-log server total (document) | 118 | 133 | 5 | app 118, gp 0; browser ready 184, long tasks 197 |
| c dev steady SMALL settings | dev-log server total (document) | 76 | 83 | 5 | app 74, gp 1.3; browser ready 150, long tasks 144 |
| c dev steady LARGE home | dev-log server total (document) | 287 | 297 | 5 | app 286, gp 0; browser ready 541, long tasks 133 |
| c dev steady LARGE projects | dev-log server total (document) | 99 | 139 | 5 | app 98, gp 0; browser ready 221, long tasks 131 |
| c dev steady LARGE wi-list | dev-log server total (document) | 393 | 431 | 5 | app 390, gp 1.7; browser ready 13020, long tasks 12662 |
| c dev steady LARGE wi-board | dev-log server total (document) | 348 | 516 | 5 | app 343, gp 3; browser ready 1619, long tasks 4158 |
| c dev steady LARGE wi-table | dev-log server total (document) | 665 | 725 | 5 | app 658, gp 4; browser ready 25590, long tasks 25048 |
| c dev steady LARGE wi-peek | dev-log server total (document) | 519 | 538 | 5 | app 512, gp 2; browser ready 16986, long tasks 14971 |
| c dev steady LARGE work-item | dev-log server total (document) | 214 | 284 | 5 | app 209, gp 2; browser ready 1579, long tasks 322 |
| c dev steady LARGE cycles | dev-log server total (document) | 166 | 178 | 5 | app 163, gp 1.3; browser ready 573, long tasks 250 |
| c dev steady LARGE cycle | dev-log server total (document) | 392 | 475 | 5 | app 390, gp 1.2; browser ready 11851, long tasks 11319 |
| c dev steady LARGE modules | dev-log server total (document) | 271 | 279 | 5 | app 262, gp 2; browser ready 1327, long tasks 310 |
| c dev steady LARGE views | dev-log server total (document) | 115 | 129 | 5 | app 113, gp 1.4; browser ready 381, long tasks 147 |
| c dev steady LARGE pages | dev-log server total (document) | 115 | 119 | 5 | app 113, gp 1.3; browser ready 361, long tasks 141 |
| c dev steady LARGE intake | dev-log server total (document) | 113 | 115 | 5 | app 110, gp 1.6; browser ready 364, long tasks 135 |
| c dev steady LARGE inbox | dev-log server total (document) | 88 | 99 | 5 | app 87, gp 0; browser ready 156, long tasks 133 |
| c dev steady LARGE yw-summary | dev-log server total (document) | 226 | 233 | 5 | app 223, gp 1.9; browser ready 295, long tasks 151 |
| c dev steady LARGE yw-assigned | dev-log server total (document) | 449 | 451 | 5 | app 447, gp 1.9; browser ready 11481, long tasks 11014 |
| c dev steady LARGE agents | dev-log server total (document) | 203 | 216 | 5 | app 201, gp 0; browser ready 1553, long tasks 159 |
| c dev steady LARGE drafts | dev-log server total (document) | 88 | 106 | 5 | app 88, gp 0; browser ready 351, long tasks 134 |
| c dev steady LARGE workspace-views | dev-log server total (document) | 85 | 91 | 5 | app 84, gp 0; browser ready 137, long tasks 132 |
| c dev steady LARGE active-cycles | dev-log server total (document) | 92 | 98 | 5 | app 92, gp 0; browser ready 376, long tasks 169 |
| c dev steady LARGE analytics | dev-log server total (document) | 162 | 164 | 5 | app 159, gp 2; browser ready 521, long tasks 232 |
| c dev steady LARGE stickies | dev-log server total (document) | 85 | 88 | 5 | app 84, gp 0; browser ready 138, long tasks 134 |
| c dev steady LARGE wiki | dev-log server total (document) | 88 | 90 | 5 | app 88, gp 0; browser ready 141, long tasks 128 |
| c dev steady LARGE settings | dev-log server total (document) | 84 | 87 | 5 | app 81, gp 1.9; browser ready 133, long tasks 140 |


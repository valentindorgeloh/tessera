# Performance probes (2026-10-24)

Measurement scripts from the performance research run, kept because the scratchpad gets wiped. The roadmap that uses them is `docs/drafts/perf-roadmap-2026-10-24.md` (its section 5 names each probe in the lanes' verify steps). They are not product code: lint skips `docs/drafts/**`, and `react/stable.ts.txt` is the prototype of the lane B helpers, renamed so the type check skips it.

Run them from a scratch copy against a production server on your own port and a copy of a fixture database, never against port 3000 or `data/tessera.db`. Most of them have a port or a base URL near the top of the file; change it before you run them.

| Folder | What |
|---|---|
| `runtime/` | `live.sh` prototype (decision 140), the swap poller, hard-load probe, dev-tab-during-build probe |
| `react/` | component-count and why-did-it-render probes, the memo and structural-sharing prototype patch (decision 141) |
| `next/` | sidebar prefetch and skeleton timing, first-peek timing (decision 142) |
| `assets/` | per-route asset probe and the chunk dominator script |
| `skeptic2/` | row-tick trace and the `:has()` bisect |
| `perf-run/` | the 2026-10-24 performance run: its probes (`scripts/`) and the medians later runs compare against (`baseline/`: the `d26461b` Measure-phase medians, the integrated round's `integ2-summary.json` and the review fixes' `fix-*-medians.json`); see `perf-run/README.md`. The run's report is `docs/drafts/perf-report-2026-10-24.md` |

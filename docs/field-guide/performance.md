# Field guide: performance of the work-item views

Surprises from the performance rounds of 2026-10-24 to 2026-10-29. Reports: docs/drafts/perf-report-2026-10-24.md and docs/drafts/perf-report-2026-10-28.md. The time goes to the browser, not the server (a 10k list read takes 5 ms), and Tessera's own components are about 1.4% of busy time; Astryx layers and React do the rest.

## Astryx 0.6.8
- `Text maxLines` measures every Text on mount, a forced layout each, even with `hasTruncateTooltip={false}`. Row text uses a CSS one-line class (`tessera-wi-title`, `tessera-wi-cell-text`, `tessera-wi-label-text`) and `OneLineText`, which measures only on hover and then shows the tooltip.
- `Popover` keeps closed content mounted. Per-row popovers pass `content={isOpen ? … : null}`. Selector listboxes and tooltips still mount closed (about 8.5 layers per row, 63% of the DOM on a 200-row list) until Astryx uses `lazyMount` (docs/drafts/astryx-upstream-2026-10-24.md).
- Every layer runs `readPortalWritingContext` (two `getComputedStyle` calls) when it mounts, then a second render pass. It is the largest forced style cost on a long list.

## React and Next
- A memoised row only skips a render when its props keep their identity, and every refresh hands client components fresh copies of the same data. Pass refreshed data through `shareStructure` or `useShared`, and row handlers through `useStableCallback` (src/components/work-items/stable.ts); rows read the lean `useProjectRow()` context, not `useProject()`, whose bundle changes on every write.
- The first write by an MCP client the app has not seen adds an actor, so every row correctly redraws its assignee options. In a probe, write as an actor that already exists, or the "first write" row measures the new actor.
- A `next/dynamic` component suspends on its first render even with the chunk cached, and React 19.3 holds a revealed Suspense fallback for at least 300 ms (`FALLBACK_THROTTLE_MS`). `PeekDetail` (src/components/detail/peek-detail-lazy.tsx) renders the loaded component directly once the chunk is in. The same hold costs a first route visit about 250 ms of idle time.

## CSS
- `:has()` on a container of a long list costs even when it never matches: `.tessera-wi-scroller:has(.tessera-wi-group)` made every style invalidation scan about 50,000 elements on the ungrouped 10k list (about 95 ms per load). Toggle a class from the component instead (`tessera-wi-scroller--grouped`).

## Measuring
- Use production builds (`next start`) for timings, interleave the two sides (A, B, A, B) with a fresh server and a fresh database copy per sample, and record the load average; dev timings and component counts are for finding causes. The budget's own harness is `tests/e2e/perf.spec.ts` (p95, n=20, `playwright.perf.config.ts`); `npm run check:bundle` guards the first-load JavaScript per route.

# Field guide: performance of the work-item views

Surprises from the performance rounds of 2026-10-24 to 2026-10-29. Reports: docs/drafts/perf-report-2026-10-24.md and docs/drafts/perf-report-2026-10-28.md. The time goes to the browser, not the server (a 10k list read takes 5 ms), and Tessera's own components are about 1.4% of busy time; Astryx layers and React do the rest.

## Astryx 0.7.11 (the measurements above are from 0.6.8)
- `Text maxLines` measured every Text on mount (a forced layout each), even with `hasTruncateTooltip={false}`. Since 0.7.2 `maxLines` with `hasTruncateTooltip={false}` neither measures nor observes (CSS alone clamps), and 0.7.6 batches the remaining measuring after commit. Row text still uses the CSS one-line classes (`tessera-wi-title`, `tessera-wi-cell-text`, `tessera-wi-label-text`) and `OneLineText` (measures on hover only, keeps the tooltip); replace `OneLineText` only after a profile on 0.7.11.
- `Popover`, `Selector` and `Tooltip` content still mounts while closed (no `lazyMount` in `usePopover`, `useSelectorPresentation` or `useTooltip`; only ContextMenu and HoverCard defer). Per-row popovers keep `content={isOpen ? … : null}`.
- A closed layer no longer reads `readPortalWritingContext` (two `getComputedStyle` calls) on mount: since 0.7.5 it reads it on first open. That was the largest forced style cost on a long list; re-measure before adding more row-level workarounds.
- 0.7 adds a motion, gesture and keyboard engine that Layer, AppShell, SideNav and Popover import, so every route's first load grew 115–200 KB gzip (list routes about 670 → 870 KB). None of it is Tessera code (checked with `next analyze --output`); the baseline and the editor ceilings in `tests/check-bundle-budget.test.ts` were reset on 2026-11-09. Use `next analyze --output` before blaming an import for the next jump.

## React and Next
- A memoised row only skips a render when its props keep their identity, and every refresh hands client components fresh copies of the same data. Pass refreshed data through `shareStructure` or `useShared`, and row handlers through `useStableCallback` (src/components/work-items/stable.ts); rows read the lean `useProjectRow()` context, not `useProject()`, whose bundle changes on every write.
- The first write by an MCP client the app has not seen adds an actor, so every row correctly redraws its assignee options. In a probe, write as an actor that already exists, or the "first write" row measures the new actor.
- A `next/dynamic` component suspends on its first render even with the chunk cached, and React 19.3 holds a revealed Suspense fallback for at least 300 ms (`FALLBACK_THROTTLE_MS`). `PeekDetail` (src/components/detail/peek-detail-lazy.tsx) renders the loaded component directly once the chunk is in. The same hold costs a first route visit about 250 ms of idle time.

## CSS
- `:has()` on a container of a long list costs even when it never matches: `.tessera-wi-scroller:has(.tessera-wi-group)` made every style invalidation scan about 50,000 elements on the ungrouped 10k list (about 95 ms per load). Toggle a class from the component instead (`tessera-wi-scroller--grouped`).

## Measuring
- Use production builds (`next start`) for timings, interleave the two sides (A, B, A, B) with a fresh server and a fresh database copy per sample, and record the load average; dev timings and component counts are for finding causes. The budget's own harness is `tests/e2e/perf.spec.ts` (p95, n=20, `playwright.perf.config.ts`); `npm run check:bundle` guards the first-load JavaScript per route.
- A probe that waits for Power K to settle must accept "No matches". With no hits Astryx renders no listbox and sets the input's `aria-expanded` to false, so a check for `aria-expanded="true"` never ends on a query without hits: `platf` has none in the 10k data, which looked like "typing never settles on 10k". Wait for the typed value, no `[role=progressbar]` beside the input (the pending search's spinner), and either `aria-expanded="true"` or the "No matches" text.

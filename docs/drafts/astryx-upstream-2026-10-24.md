# Astryx upstream: ContextMenu long-press props and two render costs (2026-10-24)

Status (2026-11-09): Astryx 0.7.11 is installed. Section 1 is fixed upstream (0.7.0, verified in `dist/ContextMenu/ContextMenu.js:505-513`), so do not file it. Section 2 is half fixed: 0.7.2 stops measuring when `hasTruncateTooltip={false}` (proposal 1; verified in `dist/Text/Text.js:131`) and 0.7.6 batches the remaining measuring after commit (#9013), but a `maxLines` Text with its tooltip still measures on mount (proposal 2 is open). Section 3 is half fixed: 0.7.5 defers `readPortalWritingContext` for closed layers (#9012, #8519), but `usePopover`, `useSelectorPresentation` and `useTooltip` still mount closed content (the `lazyMount` ask is open; 0.7.6 added `keepsMountAfterShow` and only ContextMenu and HoverCard use `lazyMount`). Section 4 steps 1 to 7 were done in the 0.7.11 upgrade; step 8 waits for a profile. Whatever stays open is still unfiled: filing posts on GitHub, so the user decides when; nothing below is sent by an agent.

Original status: ready to file, not filed.

Target: github.com/facebook/astryx (MIT), package `@astryxdesign/core`, verified against the installed 0.6.8 (`node_modules/@astryxdesign/core`, its `src/` and `dist/`) with React 19.3.0. Line numbers are from 0.6.8.

Why upstream: Tessera never imports `ContextMenu`, Astryx documents no switch that turns the Table header menu off, and the project rule is to upgrade Astryx rather than add glue (AGENTS.md, docs/contracts/ui.md). So the prop bug is fixed in Astryx, and Tessera keeps one tolerance until the upgrade. `tests/ui/astryx-contextmenu-tripwire.test.ts` ties that tolerance to the installed dist files: once an upgrade ships the fix, the tripwire turns red until the tolerance is deleted (section 4).

Contents:
1. Issue and PR: ContextMenu spreads the `useLongPress` imperative API onto its trigger (bug).
2. Issue: `Text` measures truncation even when no tooltip can use it (perf).
3. Issue: Selector, Popover and Tooltip mount closed content; `useLayer` already has `lazyMount` (perf).
4. Tessera follow-up after an upgrade that ships the fix.
5. Issue: AppShell gives no way to keep the content still while the side nav collapses (added 2026-11-10, against 0.7.11).

## 1. Bug: ContextMenu passes `start`, `moveTo` and `cancel` to its trigger element

**Fixed in Astryx 0.7.0 (#7322), confirmed in the installed 0.7.11. Nothing to file.** The text below is the 0.6.8 record.

### Issue text

**Title:** ContextMenu spreads useLongPress's start/moveTo/cancel onto its trigger element (React unknown-prop warnings)

**Body:**

Rendering any `ContextMenu` in development logs two React warnings on the first render:

```
React does not recognize the `moveTo` prop on a DOM element. If you intentionally want it to appear in the DOM as a custom attribute, spell it as lowercase `moveto` instead. If you accidentally passed it from a parent component, remove it from the DOM element.
Invalid values for props `start`, `cancel` on <div> tag. Either remove them from the element, or pass a string or number value to keep them in the DOM. For details, see https://react.dev/link/attribute-behavior
```

Every sortable `Table` header shows them too, because `useTableSortable` adds `contextMenuActions` to each sortable header (`dist/Table/plugins/sortable/useTableSortable.js:347-361`), and `TableHeaderCell` wraps itself in `wrapInTableContextMenu` (`dist/Table/TableHeaderCell.js:119`), which renders `LazyTableContextMenu`, a `ContextMenu` (`dist/Table/tableContextMenu.js:95-101`).

Cause:
- `useLongPress` returns its four touch handlers together with its imperative API: `start`, `moveTo` and `cancel` (`src/hooks/useLongPress.ts:167-175`). `useMenuPress` calls that API from its own pointer events.
- `ContextMenu` binds the whole result (`src/ContextMenu/ContextMenu.tsx:586`) and spreads it onto `TriggerElement` (`:717`; dist `ContextMenu.js:434` and `:525`). React gets three function props it does not know.
- The hook's doc says the returned object holds the four handlers "to spread onto the target element" (`src/hooks/useLongPress.doc.mjs`, `returns` and `docsDense.returnDescriptions`), so any consumer that follows it gets the same warnings.

Effect: development-console noise only. React drops function values, so the DOM gets no attribute, and React's production build prints nothing. Long-press still opens the menu.

Repro (0.6.8, React 19.3, jsdom or a browser in development):

```tsx
<ContextMenu items={[{label: 'Item 1'}]} data-testid="ctx">
  <div>Long-press me</div>
</ContextMenu>
```

The trigger's React props are `ref, onContextMenu, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, start, moveTo, cancel, data-testid, className, children`.

### PR text

**Title:** fix(ContextMenu): pass only the long-press touch handlers to the trigger

**Body:**

`useLongPress` returns `start`, `moveTo` and `cancel` next to its touch handlers, and `ContextMenu` spread the whole object onto its trigger element, so React warned about three unknown props on every first render (and on every sortable `Table` header, through `tableContextMenu`). The fix picks the four touch handlers by name. A future member of the hook's result therefore cannot reach the DOM either. A rest pattern that drops `start`, `moveTo` and `cancel` would also work, but it leaves three unused bindings and lets a new member through. The hook's doc now says to pass only the touch handlers to a DOM element.

The regression test lives in its own file. React warns about an unknown DOM prop once per prop name for the life of the module: a second `ContextMenu` render in the same module raised 0 warnings where the first raised 2. In `ContextMenu.test.tsx` an earlier test would use up the warning, and the new test would pass with the bug still there. The file relies on Vitest's default per-file module isolation.

Changelog (Fixes): "`ContextMenu` no longer passes `useLongPress`'s `start`, `moveTo` and `cancel` to its trigger element, so React's unknown-prop warnings are gone from every context menu and every sortable `Table` header."

```diff
--- a/packages/core/src/ContextMenu/ContextMenu.tsx
+++ b/packages/core/src/ContextMenu/ContextMenu.tsx
@@ -583,7 +583,10 @@
   // `contextmenu` event on long-press, so a context menu is otherwise
   // unreachable on touch. Open the menu at the touch point once the press is
   // held long enough (see useLongPress for timer/move-cancel/cleanup logic).
-  const longPressHandlers = useLongPress({
+  // Only the four touch handlers go on the trigger: the hook also returns
+  // `start`, `moveTo` and `cancel` for a caller that drives it from its own
+  // pointer events (useMenuPress), and those are not DOM props.
+  const {onTouchStart, onTouchMove, onTouchEnd, onTouchCancel} = useLongPress({
     disabled: isDisabled,
     onLongPress: useCallback(
       (point: {x: number; y: number}) => {
@@ -597,6 +600,12 @@
       [openAtLocalPoint, getAnchorBaseRect],
     ),
   });
+  const longPressHandlers = {
+    onTouchStart,
+    onTouchMove,
+    onTouchEnd,
+    onTouchCancel,
+  };
 
   const popoverXstyle = menuWidth
     ? styles.popoverCustomWidth(menuWidth)
```

The JSX at `:717` keeps `{...longPressHandlers}`, which now holds the four handlers only.

Optional second file (the doc that invites the spread):

```diff
--- a/packages/core/src/hooks/useLongPress.doc.mjs
+++ b/packages/core/src/hooks/useLongPress.doc.mjs
@@ -54,7 +54,7 @@
       name: 'handlers',
       type: 'UseLongPressHandlers',
       description:
-        'onTouchStart, onTouchMove, onTouchEnd and onTouchCancel to spread onto the target element.',
+        'onTouchStart, onTouchMove, onTouchEnd and onTouchCancel to pass to the target element, plus start, moveTo and cancel for a caller that drives the detection from its own pointer events. Pass only the four touch handlers to a DOM element; spreading the whole object adds three unknown props.',
     },
   ],
   usage: {
@@ -98,7 +98,7 @@
   },
   returnDescriptions: {
     handlers:
-      'onTouchStart / onTouchMove / onTouchEnd / onTouchCancel to spread onto the element.',
+      'onTouchStart / onTouchMove / onTouchEnd / onTouchCancel for the element, + start / moveTo / cancel for own pointer handling. Pass only the touch handlers to a DOM element.',
   },
   usage: {
     description:
```

New test file `packages/core/src/ContextMenu/ContextMenu.triggerProps.test.tsx`:

```tsx
// Copyright (c) Meta Platforms, Inc. and affiliates.
/**
 * @file ContextMenu.triggerProps.test.tsx
 * @input Uses vitest, @testing-library/react, ContextMenu component
 * @output Regression test: the trigger element receives only DOM props
 * @position Testing; validates the long-press wiring in ContextMenu.tsx
 *
 * Its own file on purpose: React warns about an unknown DOM prop once per
 * prop name for the life of the module, so after any earlier ContextMenu
 * render in the same file this test would pass with the bug.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {ContextMenu} from './ContextMenu';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ContextMenu trigger props', () => {
  it('passes only the touch handlers of useLongPress to the trigger', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(
      <ContextMenu items={[{label: 'Item 1'}]} data-testid="ctx">
        <div>Long-press me</div>
      </ContextMenu>,
    );

    const propWarnings = consoleError.mock.calls
      .map(args => args.map(String).join(' '))
      .filter(message =>
        /React does not recognize the|Invalid values? for props?/.test(message),
      );
    expect(propWarnings).toEqual([]);

    const trigger = screen.getByTestId('ctx');
    for (const name of ['moveTo', 'moveto', 'start', 'cancel']) {
      expect(trigger.hasAttribute(name)).toBe(false);
    }
  });
});
```

The `console.error` assertion is the one that fails on 0.6.8. The attribute loop holds on 0.6.8 too, because React drops function values; it guards against a later change that turns them into strings. The existing tests `opens on touch long-press` and `cancels the long-press when the finger moves past the threshold` cover the behaviour the touch handlers keep.

### What was verified here

Tessera has no Astryx checkout and no `@testing-library/react`, so the test above was not run in Astryx's harness. The same steps ran as plain scripts against the installed 0.6.8 and against a scratch copy of the package with the equivalent dist change (React 19.3 development build, jsdom 30):

| Check | 0.6.8 | Patched |
|---|---|---|
| Client render (`createRoot` in jsdom): unknown-prop warnings | 2 (`moveTo`; `start`, `cancel`) | 0 |
| Trigger's React props include `start`, `moveTo`, `cancel` | yes | no |
| Trigger attributes | `data-testid`, `class` | `data-testid`, `class` |
| Server render (`renderToString`, development): warnings | 2 | 0 |
| Server render, production build: warnings | 0 | 0 |
| Second render in the same module: warnings | 0 | 0 |
| Render without a `matchMedia` stub | throws `window.matchMedia is not a function` | same |

The Tessera tripwire predicate turns false on the installed dist with this patch applied, and on the fixed shapes in its fixtures.

## 2. Perf: `Text` measures truncation when no tooltip can use it

**Partly fixed in 0.7.11.** Proposal 1 shipped in 0.7.2 (`maxLines` with `hasTruncateTooltip={false}` neither measures nor observes) and 0.7.6 batches measuring after commit (#9013). Proposal 2 (measure on hover and focus only) and the same for `Heading` are not verified; profile before filing. The text below is the 0.6.8 record.

### Issue text

**Title:** Text with maxLines measures truncation on mount even with hasTruncateTooltip={false}

**Body:**

`Text` calls `useTruncation({maxLines})` for every `maxLines > 0` (`dist/Text/Text.js:127`, `src/Text/Text.tsx:264`; `Heading` does the same at `src/Heading/Heading.tsx:257`). The result is only used when `hasTruncateTooltip !== false` (`Text.js:133`, `Text.tsx:270`), but the measuring always runs:
- `useTruncation`'s ref callback (`src/Text/useTruncation.ts:110`) registers with `observeResize` (`:124`).
- `observeResize` calls back synchronously on registration (`src/utils/sharedResizeObserver.ts:92`).
- So `checkTruncation` reads `scrollWidth` and `offsetWidth` (one line) or a `Range` rectangle (several lines) inside React's commit, for every `Text`, and sets two states (`fullText`, `isTruncated`). The `fullText` change re-renders every `Text` once more.
- The shared `ResizeObserver` then delivers a first entry for each element and measures again. React's Strict Mode in development attaches each ref twice.

In a list of rows, every row title costs a layout read in the commit plus an extra render, whether or not a tooltip could open.

Evidence (an app list of 10 000 work items, 213 rows rendered, Chromium, development build, CPU profile of one client navigation to the list):

| Variant | Ready after click | `checkTruncation` self time |
|---|---|---|
| Rows with `maxLines={1}` texts | 9,336 ms (9,879 ms profiled) | 6,739 ms |
| Same rows without `maxLines` | 1,902 ms (2,439 ms profiled) | 96 ms |

A development load profile of the table layout on the same data, with the list rows already changed, still showed 3,569 ms of `checkTruncation` self time, from the Name and Project cells' `maxLines={1}`.

Proposal:
1. When `hasTruncateTooltip === false`, skip the measuring: call `useTruncation({maxLines: 0})`, or give the hook an `enabled` option. The clamp itself is CSS (`-webkit-line-clamp` or single-line ellipsis) and needs no measurement.
2. When the tooltip is on, measure on `pointerenter` and `focus` of the text, the only moments the tooltip can open, instead of in the ref callback. Observe resizes only while the tooltip is open, if at all.
3. The same for `Heading`.

## 3. Perf: Selector, Popover and Tooltip mount their closed content

**Partly fixed in 0.7.11.** The `readPortalWritingContext` cost is gone for closed layers (0.7.5: read on first open, #9012; #8519 re-renders only the slot). `lazyMount` for Popover, Selector and Tooltip is still not used (0.7.11 `usePopover.tsx`, `useSelectorPresentation.ts`, `useTooltip.tsx`), and 0.7.6 notes say closed Tooltips, Selectors and ComplexSelectors "render once on mount". Re-measure the closed-layer DOM before filing the remainder. The text below is the 0.6.8 record.

### Issue text

**Title:** Use useLayer's lazyMount for closed Selector, Popover and Tooltip content

**Body:**

`useLayer` in context mode takes `lazyMount` (`dist/Layer/useLayer.d.ts:175-183`): the layer and its portal position are resolved on `show()`, and hiding unmounts it. Only `HoverCard` passes it (`src/HoverCard/useHoverCard.tsx:294`). `usePopover` (`src/Popover/usePopover.tsx:415`, which `Selector` uses through `src/Selector/useSelectorPresentation.ts:90`) and `useTooltip` (`src/Tooltip/useTooltip.tsx:282`) call `useLayer({mode: 'context'})` without it. So every closed Selector listbox, Popover body and Tooltip is in the DOM. Each layer resolves its portal target when its marker attaches (`src/Layer/useLayer.tsx:1043-1050` → `requestContextMount`, `:787-806`), and `readPortalWritingContext` (`:468-493`) calls `getComputedStyle` twice per layer, which forces style recalculation while the page mounts.

Evidence (the same 10 000-item list):
- Closed layers inside the list: 593 Selector listboxes holding 29,967 DOM nodes, and 699 tooltips holding 1,398.
- That is with the app's date-picker Popover content already rendered only when open. Before that change, 400 closed date popovers held another 61,892 nodes, and the document had 113,464 nodes instead of 54,770.
- `readPortalWritingContext` took 433 ms of self time in the development navigation profile above (333 ms after the `Text` change).
- Production build, 200-row list (Tessera's profile of 2026-10-29, docs/drafts/perf-report-2026-10-28.md): the two reads account for 282 of 384 ms of forced style recalculation, and the context mount that follows renders a second pass of about 33,000 components. Stubbing the reads in an interleaved A/B (n=5 per side) saved 133 ms (−15%) on the list load, 259 ms (−18%) on a table of the same rows, and 1.3 s (−34%) on the list with 4× CPU throttling.

Proposal:
1. Pass `lazyMount` from `Tooltip` (the content is text and needs nothing while closed), from the `Selector` listbox, and from `Popover`, as the default or behind a documented prop such as `isContentMountedWhenClosed`.
2. Questions for maintainers before making it the default for `Selector`:
   - Does keyboard typeahead on a closed trigger read the mounted options?
   - Does `aria-controls` need the listbox id to exist while closed?
   - Do callers measure the closed popover?

## 4. Tessera follow-up after an upgrade that ships the fix

Done in the 2026-11-09 upgrade to 0.7.11: steps 1 to 7 (the codemods ran, `REACT_PROP_WARNING` and the tripwire are gone, `tests/e2e-tolerated.test.ts` asserts the warnings are no longer tolerated, the field-guide and ui.md lines are updated). The as-built mentions in step 7 were reworded rather than dropped. Step 8 is open until a profile on 0.7.11 shows `Text maxLines` is cheap enough.

In one change, after the Astryx release with fix 1:

1. Bump `@astryxdesign/core` and `@astryxdesign/cli`, then run `npm run astryx -- upgrade --from 0.6.8 --apply` (AGENTS.md: run `upgrade --from <old version> --apply` after a dependency bump).
2. Delete `REACT_PROP_WARNING` and its `TOLERATED_CONSOLE` entry in `tests/e2e/tolerated.ts`, and fix that file's header comment.
3. Change the first case of `tests/e2e-tolerated.test.ts`: it asserts the tolerance, so it must turn into a "no longer tolerated" case.
4. Delete the field-guide line about the Table `tableContextMenu` warnings (docs/field-guide/index.md, "Console noise to tolerate").
5. Delete `tests/ui/astryx-contextmenu-tripwire.test.ts`: it turns red on the fixed version until step 2 is done, and it has no job after that.
6. Update the docs/contracts/ui.md carried items: around line 701 ("Astryx 0.6.8 `ContextMenu` prop warnings in development: an upstream fix") and lines 2102-2106 (the two Astryx `ContextMenu` dev warnings "stay the only tolerated console entries").
7. Drop the as-built mentions: docs/as-built/planning.md:198, docs/as-built/shell-detail.md:212 and docs/as-built/work-items.md:185.
8. Once fix 2 ships (lazy measuring), replace Tessera's own `OneLineText` (`src/components/work-items/OneLineText.tsx`) with `Text maxLines={1}` again. The review of the rows lane added it so that `RowTitle`, the table's Name and Project cells and the gantt and modules-timeline labels keep their overflow tooltip while measuring only on hover, which is proposal 2 above done in the app. Re-run the dev navigation profile (docs/drafts/perf-2026-10-24/perf-run/scripts/code-nav-profile.mjs) to confirm that `checkTruncation` stays near 100 ms.

Found along the way, and gone after step 2: on React 19.3 the `start`/`cancel` warning comes in its plural form ("Invalid values for props `start`, `cancel` on <div> tag"). The `REACT_PROP_WARNING` pattern only knows the singular "Invalid value for prop", so in development that warning is not matched. The e2e suite runs on `next start`, where React prints neither warning, so no spec is affected.

## 5. AppShell: no way to keep the content still while the side nav collapses

Added 2026-11-10, verified against the installed 0.7.11 (`dist/AppShell/AppShell.js`, `dist/SideNav/SideNav.js`, `dist/motion/animatedLayout.js`). Not filed: filing posts on GitHub, so the user decides when.

Tessera's workaround is decision 149: `setNavCollapsed` sets the private `data-astryx-reduced-motion` mark on `<html>` for the change, and `tests/ui/nav-collapse-snap.test.ts` pins the Astryx code it relies on. When a release ships a documented option, use it, delete the mark and the pins, and update decision 149.

### Issue text

**Title:** AppShell: an option to collapse the side nav without the content cross-fade

**Body:**

When a collapsible `SideNav` inside `AppShell` collapses or expands, `AppShell`'s `beforeRailChange` holds a copy of the main content (`holdLayoutSwap(contentLayout, main, { isVisiblePart: true })`), and `afterRailChange` plays `playLayoutSwap`. The copy fades out, every child of `main` fades in from 0, and the column glides by the rail's travel. On a content-heavy page (a work-item list in a rounded `Card` panel) this reads as the panel reloading. Measured at 1280 px wide: `main`'s width changes from 1044 to 1232 px at once, while its left edge glides from 236 to 48 px over about 240 ms. The card inside goes 0.25 → 0.81 → 0.99 opacity over the same frames, so the eye loses its place in the list.

The only ways to turn it off today are the user's Reduce Motion setting, or the theme-wide reduced-motion mark (`data-astryx-reduced-motion`, private: no package entry exports it). The theme-wide mark also stops every other animation. There is no `AppShell` or `SideNav` prop for this.

Proposal (either would do):
1. A documented `AppShell` prop, for example `contentRailMotion: 'swap' | 'glide' | 'none'`, default `'swap'`. `'glide'` moves the column without the copy and the fade. `'none'` lands at once, as Reduce Motion does with a mouse.
2. Or a `SideNav` `collapsible` option such as `isAnimated: false`, which skips `beforeRailChange` and `afterRailChange` (and the rail's own copy) for that nav.

Repro: any `AppShell` with `sideNav={<SideNav collapsible={{ isCollapsed, onCollapsedChange }} />}` and a main area holding a scrolled list. Toggle `isCollapsed` and record `getComputedStyle(main.firstElementChild).opacity` and `main.getBoundingClientRect().left` on each animation frame.


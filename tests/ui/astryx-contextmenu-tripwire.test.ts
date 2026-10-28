import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isTolerated } from "../e2e/tolerated";

/**
 * Tripwire for the React prop-warning tolerance in tests/e2e/tolerated.ts
 * (decision 123; the field guide's "Console noise to tolerate" line).
 *
 * Astryx 0.6.8 `useLongPress` returns its touch handlers together with its
 * imperative API (`start`, `moveTo`, `cancel`), and `ContextMenu` spreads the
 * whole result onto its trigger element, so React warns about three function
 * props on a DOM node. Tessera never imports ContextMenu; it reaches it through
 * the Astryx Table: `useTableSortable` gives every sortable header
 * context-menu actions, and the header cell wraps itself in
 * `LazyTableContextMenu`.
 *
 * The test reads the installed dist files and ties the tolerance to the bug:
 * while the bug is installed the warning must be tolerated, and once an Astryx
 * upgrade fixes it the tolerance has to go in the same change (the upgrade
 * steps are in docs/drafts/astryx-upstream-2026-10-24.md).
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ASTRYX_CORE = path.join(REPO_ROOT, "node_modules", "@astryxdesign", "core");

/** React's warning for the unknown `moveTo` prop, substituted. */
const MOVE_TO_WARNING = "React does not recognize the `moveTo` prop on a DOM element";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `contextMenuJs` (ContextMenu source or dist) binds the whole
 * `useLongPress(...)` result to one name and spreads that name, as a whole,
 * into element props, while `useLongPressJs` (the hook's source or dist)
 * returns `moveTo`. A ContextMenu that destructures the result, spreads only
 * picked handlers or spreads a member of the result is not the bug, and
 * neither is a hook that no longer returns its imperative API.
 */
function hasLongPressSpreadBug(contextMenuJs: string, useLongPressJs: string): boolean {
  const binding = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useLongPress\s*\(/.exec(contextMenuJs);
  if (!binding) return false;
  // `...name,` in a compiled props object and `{...name}` in JSX; `...name.handlers` or `...pick(name)` do not count.
  const spreadsWhole = new RegExp(String.raw`\.\.\.\s*${escapeRegExp(binding[1]!)}\s*[,}]`).test(contextMenuJs);
  const returnsMoveTo = /\breturn\s*\{(?:[^{}]|\{[^{}]*\})*?\bmoveTo\b/.test(useLongPressJs);
  return spreadsWhole && returnsMoveTo;
}

function readCore(relative: string): string {
  return fs.readFileSync(path.join(ASTRYX_CORE, relative), "utf8");
}

const installedContextMenu = readCore("dist/ContextMenu/ContextMenu.js");
const installedHook = readCore("dist/hooks/useLongPress.js");
const installedVersion = (JSON.parse(readCore("package.json")) as { version: string }).version;

/** The 0.6.8 dist shape, trimmed to what the predicate reads (dist/ContextMenu/ContextMenu.js:434 and :525). */
const BUGGY_CONTEXT_MENU = `
  const longPressHandlers = useLongPress({
    disabled: isDisabled,
    onLongPress: useCallback(point => {}, [])
  });
  return /*#__PURE__*/_jsxs(TriggerElement, {
    ref: useMergedRefs(ref, triggerRef),
    ...triggerProps,
    onContextMenu: handleContextMenu,
    ...longPressHandlers,
    "data-testid": testId
  });
`;

/** dist/hooks/useLongPress.js:122-130 on 0.6.8. */
const HOOK_WITH_API = `
export function useLongPress(options) {
  useEffect(() => clear, [clear]);
  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
    start,
    moveTo,
    cancel: clear
  };
}
`;

/** The upstream fix in docs/drafts/astryx-upstream-2026-10-24.md, compiled the way the 0.6.8 dist is. */
const FIXED_CONTEXT_MENU = `
  const {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel
  } = useLongPress({
    disabled: isDisabled,
    onLongPress: useCallback(point => {}, [])
  });
  const longPressHandlers = {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel
  };
  return /*#__PURE__*/_jsxs(TriggerElement, {
    ...triggerProps,
    onContextMenu: handleContextMenu,
    ...longPressHandlers,
    "data-testid": testId
  });
`;

/** Another fix shape: rest-destructure the imperative API away (TSX source). */
const FIXED_CONTEXT_MENU_REST = `
  const {start: _start, moveTo: _moveTo, cancel: _cancel, ...longPressHandlers} = useLongPress({
    disabled: isDisabled,
    onLongPress,
  });
  return <TriggerElement {...triggerProps} onContextMenu={handleContextMenu} {...longPressHandlers} data-testid={testId} />;
`;

/** The 0.6.8 line the upstream patch replaces, and the installed file with the patch applied. */
const BUGGY_BINDING = "  const longPressHandlers = useLongPress({\n";
const PATCHED_BINDING = "  const {\n    onTouchStart,\n    onTouchMove,\n    onTouchEnd,\n    onTouchCancel\n  } = useLongPress({\n";
const PICKED_HANDLERS = "  const longPressHandlers = {\n    onTouchStart,\n    onTouchMove,\n    onTouchEnd,\n    onTouchCancel\n  };\n";

describe("Astryx ContextMenu long-press prop tripwire", () => {
  it("tolerates the moveTo/start/cancel warning exactly while the installed ContextMenu spreads useLongPress", () => {
    const installedBug = hasLongPressSpreadBug(installedContextMenu, installedHook);
    // Red after an Astryx upgrade means the bug is fixed: delete REACT_PROP_WARNING in tests/e2e/tolerated.ts and its
    // field-guide line in that change. Red the other way means the tolerance went while the bug is still installed.
    expect(isTolerated(MOVE_TO_WARNING), `Astryx ${installedVersion}: tolerated.ts must tolerate the moveTo warning exactly while the bug is installed`).toBe(installedBug);
  });

  it.runIf(installedVersion === "0.6.8")("finds the bug in the installed Astryx 0.6.8 dist", () => {
    expect(hasLongPressSpreadBug(installedContextMenu, installedHook)).toBe(true);
  });

  it("finds the bug in the trimmed 0.6.8 shape and in JSX", () => {
    expect(hasLongPressSpreadBug(BUGGY_CONTEXT_MENU, HOOK_WITH_API)).toBe(true);
    expect(hasLongPressSpreadBug("const longPressHandlers = useLongPress({});\n<TriggerElement {...longPressHandlers} data-testid={testId}>", HOOK_WITH_API)).toBe(true);
  });

  it("turns false on a fixed ContextMenu", () => {
    expect(hasLongPressSpreadBug(FIXED_CONTEXT_MENU, HOOK_WITH_API)).toBe(false);
    expect(hasLongPressSpreadBug(FIXED_CONTEXT_MENU_REST, HOOK_WITH_API)).toBe(false);
    // A member or a picked copy of the result is not the whole result, and a longer name is another variable.
    expect(hasLongPressSpreadBug("const longPress = useLongPress({});\nreturn {...longPress.touchHandlers, ...pickTouch(longPress)};", HOOK_WITH_API)).toBe(false);
    expect(hasLongPressSpreadBug("const longPress = useLongPress({});\nconst x = {...longPressTouch};", HOOK_WITH_API)).toBe(false);
  });

  it.runIf(installedContextMenu.includes(BUGGY_BINDING))("turns false on the installed ContextMenu with the upstream patch applied", () => {
    const patched = installedContextMenu
      .replace(BUGGY_BINDING, PATCHED_BINDING)
      .replace(/(\n {4}\}, \[openAtLocalPoint, getAnchorBaseRect\]\)\n {2}\}\);\n)/, `$1${PICKED_HANDLERS}`);
    expect(patched).toContain(PICKED_HANDLERS);
    expect(hasLongPressSpreadBug(patched, installedHook)).toBe(false);
  });

  it("turns false when the hook no longer returns its imperative API or ContextMenu stops using it", () => {
    const touchOnly = HOOK_WITH_API.replace("    start,\n    moveTo,\n    cancel: clear\n", "");
    expect(touchOnly).not.toMatch(/moveTo/);
    expect(hasLongPressSpreadBug(BUGGY_CONTEXT_MENU, touchOnly)).toBe(false);
    expect(hasLongPressSpreadBug(BUGGY_CONTEXT_MENU.replace(/useLongPress/g, "useTouchHold"), HOOK_WITH_API)).toBe(false);
  });
});

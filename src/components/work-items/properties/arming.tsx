"use client";

/**
 * Arming (decision 141 follow-up): a list row, a table row and a board card draw its property controls as plain
 * chips until the person points at the row or moves keyboard focus into it. Every Astryx Selector and Popover mounts a
 * layer sentinel and renders a second time even while closed, about ten per list row, so a long list paid for
 * layers nobody had opened. A chip is one Astryx Button with the control's current value; arming swaps it for the real
 * control, which then opens when the activation that armed the row was a click on that very chip (touch and assistive
 * technology never hover first).
 *
 * The default context value is armed, so the property rail, the dialogs, the bulk bar and every other control user
 * stay as they were. The armed state lives inside the row (a `useState` of the memoized list row, or the table's
 * per-table store), so arming re-renders that row alone.
 *
 * No arming on pointer-down or on a touch pointer: a tap that replaced its own target between pointer-down and
 * pointer-up would lose its click. A touch tap arms through the chip's click, which also opens the control.
 */
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Stack";
import { useStableCallback } from "../stable";

/** What the armed controls of a row read: whether to draw the real control, which one opens, which one takes focus. */
export type ArmState = {
  armed: boolean;
  /** The `armKey` of the control the arming click was aimed at; it mounts open. */
  openKey: string | null;
  /** The `armKey` of the chip that had keyboard focus when the row armed; its control takes the focus over. */
  focusKey: string | null;
  /** Arms the row; a chip passes its own key twice, so its control opens and takes the focus the chip held. */
  arm: (openKey?: string, focusKey?: string) => void;
  /** The control `armKey` has mounted with what the arming click asked of it: the open and focus intents are spent. */
  consume: (armKey: string) => void;
  /** A table cell: a selector fills the cell and shows its chevron, so its chip does too. */
  isCell: boolean;
};

const noop = () => undefined;

export const ArmedContext = createContext<ArmState>({ armed: true, openKey: null, focusKey: null, arm: noop, consume: noop, isCell: false });

/** The row's arming state; armed outside a row that arms (the default). */
export function useArmed(): ArmState {
  return useContext(ArmedContext);
}

/** The `data-arm-key` attribute a chip carries, so a row can tell which chip had focus when it armed. */
const ARM_KEY_ATTRIBUTE = "data-arm-key";

type Intent = { armed: boolean; openKey: string | null; focusKey: string | null };

const UNARMED: Intent = { armed: false, openKey: null, focusKey: null };

/** `intent` without what `armKey`'s control asked for (the same object when it asked for nothing). */
function spent(intent: Intent, armKey: string): Intent {
  if (intent.openKey !== armKey && intent.focusKey !== armKey) return intent;
  return { ...intent, openKey: intent.openKey === armKey ? null : intent.openKey, focusKey: intent.focusKey === armKey ? null : intent.focusKey };
}

/** The `armKey` of the chip that holds focus inside `row`, or null. */
function focusedChipKey(row: HTMLElement): string | null {
  const active = row.ownerDocument.activeElement;
  return active instanceof HTMLElement && row.contains(active) ? active.getAttribute(ARM_KEY_ATTRIBUTE) : null;
}

/**
 * A mouse arms the row when it enters it or moves over it. The move covers a row that appears under a resting pointer
 * (a quick-add, a refresh that moves the rows): the browser sends that row no enter until the pointer leaves it.
 */
export type RowArmingHandlers = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
};

/**
 * Local arming for a row that is itself a memoized component (the list row, the board card). Spread the handlers on
 * the row element and put `state` into an `ArmedContext` around its controls. The handlers have one identity and do
 * nothing once the row is armed.
 */
export function useRowArming(): { state: ArmState; handlers: RowArmingHandlers } {
  const [intent, setIntent] = useState<Intent>(UNARMED);
  const arm = useStableCallback((openKey?: string, focusKey?: string) => {
    setIntent((previous) => (previous.armed ? previous : { armed: true, openKey: openKey ?? null, focusKey: focusKey ?? null }));
  });
  const consume = useStableCallback((armKey: string) => {
    setIntent((previous) => spent(previous, armKey));
  });
  // Once armed, a move returns before any state update, so moving over an armed row renders nothing.
  const onPointer = useStableCallback((event: PointerEvent<HTMLElement>) => {
    if (!intent.armed && event.pointerType === "mouse") arm(undefined, focusedChipKey(event.currentTarget) ?? undefined);
  });
  const onFocus = useStableCallback((event: FocusEvent<HTMLElement>) => {
    // A chip is a real button: focusing it keeps it a chip, and its click arms and opens the control.
    if (event.target.hasAttribute(ARM_KEY_ATTRIBUTE)) return;
    arm();
  });
  const handlers = useMemo<RowArmingHandlers>(() => ({ onPointerEnter: onPointer, onPointerMove: onPointer, onFocus }), [onPointer, onFocus]);
  const state = useMemo<ArmState>(() => ({ ...intent, arm, consume, isCell: false }), [intent, arm, consume]);
  return { state, handlers };
}

/**
 * The table's arming store: one per table, because a Table row is a plugin-built element with no state of its own.
 * `get` returns the same object until a row's state changes, so `useSyncExternalStore` re-renders the cells of the
 * armed row only.
 */
export type ArmedRows = {
  subscribe: (listener: () => void) => () => void;
  get: (rowId: string) => Intent;
  arm: (rowId: string, openKey?: string, focusKey?: string) => void;
  /** The control `armKey` of the row mounted with what the arming click asked of it. */
  consume: (rowId: string, armKey: string) => void;
};

export function createArmedRows(): ArmedRows {
  const rows = new Map<string, Intent>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (rowId) => rows.get(rowId) ?? UNARMED,
    arm(rowId, openKey, focusKey) {
      if (rows.has(rowId)) return;
      rows.set(rowId, { armed: true, openKey: openKey ?? null, focusKey: focusKey ?? null });
      for (const listener of listeners) listener();
    },
    consume(rowId, armKey) {
      const intent = rows.get(rowId);
      if (!intent) return;
      const next = spent(intent, armKey);
      if (next === intent) return;
      rows.set(rowId, next);
      for (const listener of listeners) listener();
    },
  };
}

/** The arming handlers of a Table row (`transformBodyRow`), for `rowId`. */
export function tableRowArmingHandlers(store: ArmedRows, rowId: string): RowArmingHandlers {
  const onPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") store.arm(rowId, undefined, focusedChipKey(event.currentTarget) ?? undefined);
  };
  return {
    onPointerEnter: onPointer,
    onPointerMove: onPointer,
    onFocus: (event) => {
      if (!event.target.hasAttribute(ARM_KEY_ATTRIBUTE)) store.arm(rowId);
    },
  };
}

const NEVER_ARMED = (): Intent => UNARMED;

/** A table cell's controls: armed once the cell's row is. */
export function ArmedCell({ store, rowId, children }: { store: ArmedRows; rowId: string; children: ReactNode }) {
  const intent = useSyncExternalStore(store.subscribe, () => store.get(rowId), NEVER_ARMED);
  const arm = useStableCallback((openKey?: string, focusKey?: string) => store.arm(rowId, openKey, focusKey));
  const consume = useStableCallback((armKey: string) => store.consume(rowId, armKey));
  const state = useMemo<ArmState>(() => ({ ...intent, arm, consume, isCell: true }), [intent, arm, consume]);
  return <ArmedContext value={state}>{children}</ArmedContext>;
}

type PropertyChipProps = {
  /** Accessible name: the control's label and its value ("State: Todo"). */
  label: string;
  armKey: string;
  arm: ArmState["arm"];
  /** The visible value, the same node the armed control shows. */
  children?: ReactNode;
  icon?: ReactNode;
  isIconOnly?: boolean;
  isDisabled?: boolean;
  /** Marks an overdue date for work-items.css. */
  isOverdue?: boolean;
  className?: string;
  /** The chip stands for a selector: in a table cell it fills the cell and shows the chevron, as the selector does. */
  isSelector?: boolean;
  /** The armed selector shows its clear button beside the value (a set value of a clearable selector): the chip holds an inert glyph of the same size, so the row does not shift when it arms. */
  hasClear?: boolean;
  /** The full value on hover; only for a chip of an armed row (a tooltip mounts a layer, which a resting chip avoids). */
  tooltip?: string;
};

/**
 * The resting look of a property control: a ghost Button with the chip class of work-items.css (the same 24px outlined
 * chip as the armed Selector or date button). Activating it arms the row and opens the control it stands for.
 */
export function PropertyChip({ label, armKey, arm, children, icon, isIconOnly, isDisabled, isOverdue, className, isSelector = false, hasClear = false, tooltip }: PropertyChipProps) {
  const { isCell } = useArmed();
  const fillsCell = isSelector && isCell;
  const clear = hasClear ? <Icon icon="close" size="sm" color="secondary" className="tessera-wi-chip-clear" /> : null;
  const chevron = fillsCell ? <Icon icon="chevronDown" size="sm" color="secondary" /> : null;
  // The selector lays its value, clear button and chevron out one gap (8px) apart.
  const endContent = clear && chevron ? <HStack gap={2} vAlign="center">{clear}{chevron}</HStack> : (clear ?? chevron ?? undefined);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className ? `tessera-wi-chip ${className}` : "tessera-wi-chip"}
      label={label}
      icon={icon}
      isIconOnly={isIconOnly}
      isDisabled={isDisabled}
      tooltip={tooltip}
      width={fillsCell ? "100%" : undefined}
      endContent={endContent}
      data-overdue={isOverdue ? "" : undefined}
      data-fill={fillsCell ? "" : undefined}
      data-arm-key={armKey}
      onClick={() => arm(armKey, armKey)}
    >
      {children}
    </Button>
  );
}

/**
 * Props for the armed control's trigger. `takeFocus`, a callback ref, runs at commit once the control has mounted: it
 * takes the focus a chip held when the row armed (only while focus is on the body, since the chip left the DOM), then
 * spends the row's intent for this control through `consume`, so the control opens and takes focus that once. A later
 * mount of the same control (a property switched off and on, a group collapsed and expanded) starts closed and leaves the
 * focus alone. It is undefined while the row asks nothing of the control.
 */
export function useArmedHandoff(armKey: string | undefined): { isDefaultOpen: boolean; takeFocus: ((element: HTMLButtonElement | null) => void) | undefined } {
  const { openKey, focusKey, consume } = useArmed();
  const wantsFocus = armKey !== undefined && focusKey === armKey;
  const isDefaultOpen = armKey !== undefined && openKey === armKey;
  const takeFocus = useMemo(
    () =>
      armKey !== undefined && (wantsFocus || isDefaultOpen)
        ? (element: HTMLButtonElement | null) => {
            if (!element) return;
            if (wantsFocus && element.ownerDocument.activeElement === element.ownerDocument.body) element.focus({ preventScroll: true });
            consume(armKey);
          }
        : undefined,
    [armKey, wantsFocus, isDefaultOpen, consume],
  );
  return { isDefaultOpen, takeFocus };
}

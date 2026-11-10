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
import { useStableCallback } from "../stable";

/** What the armed controls of a row read: whether to draw the real control, which one opens, which one takes focus. */
export type ArmState = {
  armed: boolean;
  /** The `armKey` of the control the arming click was aimed at; it mounts open. */
  openKey: string | null;
  /** The `armKey` of the chip that had keyboard focus when the row armed; its control takes the focus over. */
  focusKey: string | null;
  arm: (openKey?: string) => void;
  /** A table cell: a selector fills the cell and shows its chevron, so its chip does too. */
  isCell: boolean;
};

const noop = () => undefined;

export const ArmedContext = createContext<ArmState>({ armed: true, openKey: null, focusKey: null, arm: noop, isCell: false });

/** The row's arming state; armed outside a row that arms (the default). */
export function useArmed(): ArmState {
  return useContext(ArmedContext);
}

/** The `data-arm-key` attribute a chip carries, so a row can tell which chip had focus when it armed. */
const ARM_KEY_ATTRIBUTE = "data-arm-key";

type Intent = { armed: boolean; openKey: string | null; focusKey: string | null };

const UNARMED: Intent = { armed: false, openKey: null, focusKey: null };

/** The `armKey` of the chip that holds focus inside `row`, or null. */
function focusedChipKey(row: HTMLElement): string | null {
  const active = row.ownerDocument.activeElement;
  return active instanceof HTMLElement && row.contains(active) ? active.getAttribute(ARM_KEY_ATTRIBUTE) : null;
}

export type RowArmingHandlers = {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
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
  const onPointerEnter = useStableCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") arm(undefined, focusedChipKey(event.currentTarget) ?? undefined);
  });
  const onFocus = useStableCallback((event: FocusEvent<HTMLElement>) => {
    // A chip is a real button: focusing it keeps it a chip, and its click arms and opens the control.
    if (event.target.hasAttribute(ARM_KEY_ATTRIBUTE)) return;
    arm();
  });
  const handlers = useMemo<RowArmingHandlers>(() => ({ onPointerEnter, onFocus }), [onPointerEnter, onFocus]);
  const state = useMemo<ArmState>(() => ({ ...intent, arm, isCell: false }), [intent, arm]);
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
  };
}

/** The arming handlers of a Table row (`transformBodyRow`), for `rowId`. */
export function tableRowArmingHandlers(store: ArmedRows, rowId: string): RowArmingHandlers {
  return {
    onPointerEnter: (event) => {
      if (event.pointerType === "mouse") store.arm(rowId, undefined, focusedChipKey(event.currentTarget) ?? undefined);
    },
    onFocus: (event) => {
      if (!event.target.hasAttribute(ARM_KEY_ATTRIBUTE)) store.arm(rowId);
    },
  };
}

const NEVER_ARMED = (): Intent => UNARMED;

/** A table cell's controls: armed once the cell's row is. */
export function ArmedCell({ store, rowId, children }: { store: ArmedRows; rowId: string; children: ReactNode }) {
  const intent = useSyncExternalStore(store.subscribe, () => store.get(rowId), NEVER_ARMED);
  const arm = useStableCallback((openKey?: string) => store.arm(rowId, openKey));
  const state = useMemo<ArmState>(() => ({ ...intent, arm, isCell: true }), [intent, arm]);
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
};

/**
 * The resting look of a property control: a ghost Button with the chip class of work-items.css (the same 24px outlined
 * chip as the armed Selector or date button). Activating it arms the row and opens the control it stands for.
 */
export function PropertyChip({ label, armKey, arm, children, icon, isIconOnly, isDisabled, isOverdue, className, isSelector = false }: PropertyChipProps) {
  const { isCell } = useArmed();
  const fillsCell = isSelector && isCell;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className ? `tessera-wi-chip ${className}` : "tessera-wi-chip"}
      label={label}
      icon={icon}
      isIconOnly={isIconOnly}
      isDisabled={isDisabled}
      width={fillsCell ? "100%" : undefined}
      endContent={fillsCell ? <Icon icon="chevronDown" size="sm" color="secondary" /> : undefined}
      data-overdue={isOverdue ? "" : undefined}
      data-fill={fillsCell ? "" : undefined}
      data-arm-key={armKey}
      onClick={() => arm(armKey)}
    >
      {children}
    </Button>
  );
}

/**
 * Props for the armed control's trigger: `takeFocus`, a callback ref, takes the focus a chip held when the row armed (a callback ref runs at
 * commit, after the chip left the DOM; it acts only while focus is on the body, so a later render never steals it),
 * and the control opens when the arming click was aimed at it.
 */
export function useArmedHandoff(armKey: string | undefined): { isDefaultOpen: boolean; takeFocus: ((element: HTMLButtonElement | null) => void) | undefined } {
  const { openKey, focusKey } = useArmed();
  const wantsFocus = armKey !== undefined && focusKey === armKey;
  const takeFocus = useMemo(
    () =>
      wantsFocus
        ? (element: HTMLButtonElement | null) => {
            if (element && element.ownerDocument.activeElement === element.ownerDocument.body) element.focus({ preventScroll: true });
          }
        : undefined,
    [wantsFocus],
  );
  return { isDefaultOpen: armKey !== undefined && openKey === armKey, takeFocus };
}

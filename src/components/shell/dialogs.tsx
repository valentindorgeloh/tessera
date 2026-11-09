"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { AlertDialog as AstryxAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Dialog as AstryxDialog } from "@astryxdesign/core/Dialog";
import { useMergedRefs } from "@astryxdesign/core/hooks";

export { DialogHeader } from "@astryxdesign/core/Dialog";

/**
 * Dialog and AlertDialog for the whole app (lint-enforced, eslint.config.mjs).
 *
 * Next keeps the route a navigation leaves mounted under React
 * `<Activity mode="hidden">`. Astryx opens its native `<dialog>` with
 * `showModal()` in an effect that has no cleanup, so a dialog open during a
 * navigation stayed modal without a box and made the next page inert. React runs
 * layout-effect cleanups when Activity hides a route, so this wrapper closes
 * the element there (Next: "Effect and media cleanup" in
 * `01-app/02-guides/preserving-ui-state.md`). React state is untouched: when
 * Back shows the route again, Astryx's own effect sees `isOpen` and calls
 * `showModal()` again.
 *
 * The element comes through Astryx's public `ref`, captured in the effect body
 * (the ref is already cleared when the cleanup runs on unmount). Known limits:
 * focus after Back goes to <body>, and the BottomSheet presentation Astryx uses
 * on touch screens is not covered.
 */
function useCloseOnHide(ref: ComponentProps<typeof AstryxDialog>["ref"], isOpen: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  useRestoreOpenerFocus(dialogRef, isOpen);
  return useMergedRefs<HTMLDialogElement>(ref, dialogRef);
}

/**
 * Gives focus back to the element that opened the dialog, also when the dialog
 * holds an autofocused field. Astryx remembers `document.activeElement` when its
 * open effect runs, but a field with `autoFocus` has already taken focus by then
 * (React focuses it during the commit, before `showModal()`), so Astryx saves
 * that field. On close the form unmounts and the saved element is gone, so focus
 * fell to <body> (visual audit, New project dialog). This keeps the last
 * focused element outside the dialog until the dialog is modal, and refocuses
 * it after a close when focus was lost.
 */
function useRestoreOpenerFocus(dialogRef: { current: HTMLDialogElement | null }, isOpen: boolean) {
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !dialog || dialog.open || dialog.contains(target)) return;
      openerRef.current = target;
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [dialogRef]);
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      // A dialog a screen mounts only while it is open (`{dialog ? <Dialog isOpen /> : null}`, opened from a menu row) has no focus history of its own: take the module's.
      if (openerRef.current === null) openerRef.current = lastFocusOutside;
      const node = dialogRef.current;
      return () => {
        // That dialog unmounts while open, so the close branch below never runs. Once its node is gone, give focus back here. A node still in the document is a re-render, an effect replay or Activity hiding the route, not an unmount.
        queueMicrotask(() => {
          if (node?.isConnected) return;
          restoreFocus(openerRef.current);
        });
      };
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    restoreFocus(opener);
  }, [isOpen, dialogRef]);
}

/**
 * Refocuses the opener when focus was lost (a removed form field leaves it on <body>). A nested dialog
 * ("Save this draft?" over the create dialog) records a field of the dialog under it as its opener, and
 * that field unmounts together with it: fall back to the last element focused outside any dialog, the
 * control that opened the outer dialog.
 */
function restoreFocus(opener: HTMLElement | null) {
  const active = document.activeElement;
  // A button of a dialog that has just closed stays `activeElement` until the browser's next rendering step (focus fixup), so it counts as lost too.
  const lost = active === null || active === document.body || !active.isConnected || active.closest("dialog:not([open])") !== null;
  if (!lost) return;
  const target = opener?.isConnected ? opener : lastFocusOutside;
  if (target?.isConnected) target.focus();
}

/**
 * The last element focused outside any dialog or popup menu, tracked from the
 * first import of this module (a dialog that mounts open starts too late to see
 * the trigger's focus). A menu row's own focus is skipped, so a dialog opened
 * from a "..." menu gives focus back to the menu's button.
 */
let lastFocusOutside: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest("dialog, [role='menu'], [role='listbox']")) lastFocusOutside = target;
    },
    true,
  );
}

export function Dialog({ ref, ...props }: ComponentProps<typeof AstryxDialog>) {
  const merged = useCloseOnHide(ref, props.isOpen);
  return <AstryxDialog {...props} ref={merged} />;
}

export function AlertDialog({ ref, ...props }: ComponentProps<typeof AstryxAlertDialog>) {
  const merged = useCloseOnHide(ref, props.isOpen);
  return <AstryxAlertDialog {...props} ref={merged} />;
}

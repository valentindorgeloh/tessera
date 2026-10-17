"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
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
function useCloseOnHide(ref: ComponentProps<typeof AstryxDialog>["ref"]) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return useMergedRefs<HTMLDialogElement>(ref, dialogRef);
}

export function Dialog({ ref, ...props }: ComponentProps<typeof AstryxDialog>) {
  const merged = useCloseOnHide(ref);
  return <AstryxDialog {...props} ref={merged} />;
}

export function AlertDialog({ ref, ...props }: ComponentProps<typeof AstryxAlertDialog>) {
  const merged = useCloseOnHide(ref);
  return <AstryxAlertDialog {...props} ref={merged} />;
}

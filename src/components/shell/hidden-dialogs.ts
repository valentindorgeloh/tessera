/**
 * Modal dialogs left open in a hidden route (docs/contracts/ui.md "P3:
 * cycles, modules, archives", as built). Under Cache Components Next keeps
 * the routes a navigation leaves mounted and hides them with React
 * `<Activity mode="hidden">` (`display: none`; see
 * node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md). The
 * Astryx Dialog opens its native `<dialog>` with `showModal()` in an effect
 * and closes it only when `isOpen` turns false; hiding keeps `isOpen` and
 * runs no close. A dialog that was open when the route was left (a link in
 * the modal peek, Power K, a redirect after an action) therefore stays in the
 * top layer without a box, and its modality makes the page shown next inert.
 *
 * `closeHiddenDialogs` closes such dialogs. The component state is untouched,
 * so when the route is shown again (Back) the Dialog's effect runs again,
 * finds the element closed and calls `showModal()`: the dialog comes back
 * with its contents, as the rest of the preserved route does.
 */

/** False when the element has no box: it or an ancestor has `display: none`. */
export function isRendered(element: Element): boolean {
  if (typeof element.checkVisibility === "function") return element.checkVisibility();
  // Engines without checkVisibility (and jsdom): walk the ancestors.
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/** Closes every open `<dialog>` under `root` that is not rendered; returns how many it closed. */
export function closeHiddenDialogs(root: ParentNode, rendered: (element: Element) => boolean = isRendered): number {
  let closed = 0;
  for (const dialog of root.querySelectorAll("dialog")) {
    if (!dialog.open || rendered(dialog)) continue;
    dialog.close();
    closed += 1;
  }
  return closed;
}

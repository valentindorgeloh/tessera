/**
 * Console noise the e2e `page` fixture tolerates (decision 123): only what the
 * field guide lists. It lives apart from fixtures.ts so a Vitest can import it
 * without loading Playwright.
 *
 * The Astryx Table `tableContextMenu` warnings are React unknown-prop warnings
 * about `moveTo`, `start` and `cancel`. Each pattern anchors on React's warning
 * text first and then on the prop name, so an uncaught exception or an error
 * that merely mentions "start" or "cancel" is not tolerated. A page error is
 * never tolerated through this list (the fixture prefixes it `pageerror:`).
 * Playwright prints React's `%s` format unsubstituted and appends the
 * arguments, so the prop name follows the warning text.
 */
const REACT_PROP_WARNING = String.raw`(?:React does not recognize the|Invalid value for prop|Received \S+ for a non-boolean attribute|Invalid DOM property|Unknown event handler property)[\s\S]*?\b(?:moveTo|start|cancel)\b`;

export const TOLERATED_CONSOLE: readonly RegExp[] = [
  new RegExp(`^${REACT_PROP_WARNING}`, "i"),
  // React's prerender measure warning (field guide: dev-only, no app code involved).
  /^Failed to execute 'measure' on 'Performance'[\s\S]*cannot have a negative time stamp/i,
  // Chrome's nameless form-field note (a console issue, not an app error).
  /^A form field element should have an id or name attribute/i,
];

/** True when a console error text matches the field-guide tolerated list. */
export function isTolerated(text: string): boolean {
  return TOLERATED_CONSOLE.some((pattern) => pattern.test(text));
}

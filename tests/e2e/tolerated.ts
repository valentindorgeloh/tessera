/**
 * Console noise the e2e `page` fixture tolerates (decision 123): only what the
 * field guide lists. It lives apart from fixtures.ts so a Vitest can import it
 * without loading Playwright.
 *
 * A page error is never tolerated through this list (the fixture prefixes it
 * `pageerror:`). The Astryx Table `tableContextMenu` React prop warnings were
 * tolerated until Astryx 0.7.0 stopped spreading the long-press API onto the
 * ContextMenu trigger; no Astryx warning is tolerated any more.
 */
export const TOLERATED_CONSOLE: readonly RegExp[] = [
  // React's prerender measure warning (field guide: dev-only, no app code involved).
  /^Failed to execute 'measure' on 'Performance'[\s\S]*cannot have a negative time stamp/i,
  // Chrome's nameless form-field note (a console issue, not an app error).
  /^A form field element should have an id or name attribute/i,
];

/** True when a console error text matches the field-guide tolerated list. */
export function isTolerated(text: string): boolean {
  return TOLERATED_CONSOLE.some((pattern) => pattern.test(text));
}

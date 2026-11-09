/**
 * Custom properties for a `style` prop. A `--tessera-*` name is not a valid
 * `CSSProperties` key, so every style object that sets one goes through here,
 * with the name as a literal quoted key: `cssVars({ "--tessera-virtual-before": "12px" })`.
 * The convention gate (`scripts/convention-rules.ts`, `definedTokens`) reads
 * the key inside the call (docs/contracts/ui.md "Sidebar views, motion,
 * virtual lists, calendar zoom", token gate).
 */
import type { CSSProperties } from "react";

export function cssVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}

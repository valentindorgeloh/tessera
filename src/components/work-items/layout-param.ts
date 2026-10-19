/**
 * A plain `?layout=list|board|table|calendar|gantt` param on a work items URL
 * switches the layout. The display itself lives in the `q` blob, so the
 * screen merges the param into the URL state and drops it (URL only; nothing
 * is saved to the view settings). Pure and client-safe.
 */
import { LayoutSchema } from "@/lib/tessera/schemas";
import type { Layout } from "@/lib/tessera/types";
import type { UrlState } from "./types";
import { encodeUrlState } from "./url-state";

export const LAYOUT_PARAM = "layout";

/** The layout a `?layout=` value names, or null for a missing or unknown value. */
export function layoutFromParam(value: string | null | undefined): Layout | null {
  const parsed = LayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** `pathname` with `layout` merged into the `q` display half, the `layout` param removed and every other param kept. */
export function hrefWithLayout(pathname: string, search: string, urlState: UrlState, layout: Layout): string {
  const params = new URLSearchParams(search);
  params.delete(LAYOUT_PARAM);
  const q = encodeUrlState({ ...urlState, display: { ...(urlState.display ?? {}), layout } });
  if (q) params.set("q", q);
  else params.delete("q");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

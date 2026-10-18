/**
 * Entity links inside descriptions (docs/contracts/editor.md, "links.ts").
 * A work item, page, cycle or module is referenced as an ordinary Markdown
 * link whose href carries one of the entity schemes (`work:WEB-12`,
 * `page:<id>`, `cycle:<uuid>`, `module:<uuid>`, `actor:<id>`); the editor draws
 * such links as chips and the host navigates when one is clicked. Pure helpers,
 * no DOM.
 */

export const ENTITY_LINK_SCHEMES = ["work", "page", "cycle", "module", "actor"] as const;

/**
 * The built-in user. Same id as `USER_ACTOR_ID` in the engine; this file is
 * imported by client components, which cannot import the actors module.
 */
const USER_ACTOR_ID = "00000000-0000-7000-8000-000000000001";

export type EntityLinkScheme = (typeof ENTITY_LINK_SCHEMES)[number];

/** `{ scheme: "work", ref: "WEB-12" }` for `work:WEB-12`. */
export type EntityLink = { scheme: EntityLinkScheme; ref: string };

/** Schemes the editor accepts besides the entity schemes. */
const WEB_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/** `scheme:rest` per RFC 3986: a letter followed by letters, digits, `+`, `.` or `-`. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):([\s\S]*)$/i;

function isEntityScheme(value: string): value is EntityLinkScheme {
  return (ENTITY_LINK_SCHEMES as readonly string[]).includes(value);
}

/** Splits a URI into its lower-cased scheme and the remainder, or null without a scheme. */
function splitScheme(uri: string): { scheme: string; rest: string } | null {
  const match = SCHEME_RE.exec(uri.trim());
  if (!match) return null;
  return { scheme: match[1].toLowerCase(), rest: match[2].trim() };
}

/** `"work:WEB-12"` → `{ scheme: "work", ref: "WEB-12" }`; `"https://…"` and malformed hrefs → null. */
export function parseEntityHref(href: string): EntityLink | null {
  const parts = splitScheme(href);
  if (!parts || !isEntityScheme(parts.scheme) || parts.rest === "") return null;
  return { scheme: parts.scheme, ref: parts.rest };
}

/** `{ scheme: "work", ref: "WEB-12" }` → `"work:WEB-12"`. */
export function entityHref(link: EntityLink): string {
  return `${link.scheme}:${link.ref}`;
}

/**
 * True for http(s) and mailto URIs and for entity hrefs whose scheme is in
 * `schemes` (default: the entity schemes). Accepts the Link extension's
 * `protocols` entries (`string | { scheme }`) so it can be passed
 * `ctx.protocols` from `isAllowedUri` unchanged. Everything else, including
 * `javascript:` and scheme-less text, is rejected here; the Link extension's
 * own `defaultValidate` decides about plain `example.com` style input.
 */
export function isAllowedEditorUri(url: string, schemes: readonly (string | { scheme: string })[] = ENTITY_LINK_SCHEMES): boolean {
  const parts = splitScheme(url);
  if (!parts) return false;
  if (WEB_SCHEMES.has(parts.scheme)) return true;
  if (parts.rest === "") return false;
  return schemes.some((entry) => (typeof entry === "string" ? entry : entry.scheme).toLowerCase() === parts.scheme);
}

/**
 * Route for an entity link. Work items resolve through `/browse/[key]`. Cycles
 * and modules use the alias routes, which redirect into their project. An actor
 * opens that actor's profile: the user at `/your-work/summary`, every other
 * actor at `/agents/<id>/summary`. Pages stay unresolved here; the page editor
 * routes `page:` itself.
 */
export function entityRoute(link: EntityLink): string | null {
  switch (link.scheme) {
    case "work":
      return `/browse/${encodeURIComponent(link.ref)}`;
    case "cycle":
      return `/cycles/${encodeURIComponent(link.ref)}`;
    case "module":
      return `/modules/${encodeURIComponent(link.ref)}`;
    case "actor":
      if (link.ref === USER_ACTOR_ID) return "/your-work/summary";
      return `/agents/${encodeURIComponent(link.ref)}/summary`;
    default:
      return null;
  }
}

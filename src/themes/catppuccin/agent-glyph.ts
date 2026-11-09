/**
 * Generated avatars for non-human actors (docs/contracts/ui.md "Actors"). An
 * agent gets a small robot face built from parts picked by a hash of its id, on
 * a tile in its palette colour, so two agents with the same colour still look
 * different and an agent keeps its face when renamed. The Assistant shows a
 * sparkle and System a gear. The SVG goes to Astryx `Avatar` as a data URI, so
 * it cannot read theme tokens: it uses the Frappé hues, which read on both the
 * Latte and the Frappé surfaces, with the face in Frappé crust.
 */
import type { ActorKind, PaletteColor } from "@/lib/tessera/types";
import { FRAPPE, PALETTE_KEY_COLOURS } from "./palette";

const FACE = FRAPPE.crust;

/** 32-bit FNV-1a, so a face depends only on the id and never on render order. */
export function glyphHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A face part: markup from the tile colour (for cut-outs) and the head's top edge. */
type Part = (tile: string, top: number) => string;

const HEADS: { top: number; svg: string }[] = [
  { top: 13, svg: `<rect x="9" y="13" width="22" height="17" rx="5"/>` },
  { top: 14, svg: `<rect x="8" y="14" width="24" height="15" rx="7.5"/>` },
  { top: 12, svg: `<rect x="10" y="12" width="20" height="19" rx="3"/>` },
  { top: 11, svg: `<rect x="9" y="11" width="22" height="20" rx="10"/>` },
];

const ANTENNAS: Part[] = [
  () => "",
  (_, top) => `<rect x="19" y="7" width="2" height="${top - 6}"/><circle cx="20" cy="6.5" r="2.4"/>`,
  (_, top) =>
    `<path d="M16 ${top + 1} L13.5 7.5 M24 ${top + 1} L26.5 7.5" stroke="${FACE}" stroke-width="2" stroke-linecap="round" fill="none"/>` +
    `<circle cx="13.5" cy="7" r="2"/><circle cx="26.5" cy="7" r="2"/>`,
  (_, top) => `<rect x="16.5" y="${top - 4}" width="7" height="5" rx="1.5"/>`,
];

const EARS: Part[] = [() => "", () => `<rect x="5.5" y="18" width="4" height="7" rx="1.5"/><rect x="30.5" y="18" width="4" height="7" rx="1.5"/>`];

const EYES: Part[] = [
  (tile) => `<circle cx="15.5" cy="20" r="2.6" fill="${tile}"/><circle cx="24.5" cy="20" r="2.6" fill="${tile}"/>`,
  (tile) => `<rect x="12" y="17.8" width="16" height="4.6" rx="2.3" fill="${tile}"/>`,
  (tile) => `<rect x="13" y="17.5" width="5" height="5" rx="1" fill="${tile}"/><rect x="22" y="17.5" width="5" height="5" rx="1" fill="${tile}"/>`,
  (tile) => `<circle cx="20" cy="20" r="3.8" fill="${tile}"/><circle cx="20" cy="20" r="1.5"/>`,
  (tile) => `<path d="M13 21.5 q2.5 -4 5 0 M22 21.5 q2.5 -4 5 0" stroke="${tile}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`,
];

const MOUTHS: Part[] = [
  (tile) => `<rect x="16" y="25.3" width="8" height="2.2" rx="1.1" fill="${tile}"/>`,
  (tile) => `<path d="M15.5 25 q4.5 3.6 9 0" stroke="${tile}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  (tile) => `<g fill="${tile}"><rect x="15" y="25" width="2" height="3" rx="0.6"/><rect x="19" y="25" width="2" height="3" rx="0.6"/><rect x="23" y="25" width="2" height="3" rx="0.6"/></g>`,
  (tile) => `<circle cx="20" cy="26.4" r="1.7" fill="${tile}"/>`,
];

const SPARKLE =
  `<path d="M18 9 C19 16.5 21.5 19 29 20 C21.5 21 19 23.5 18 31 C17 23.5 14.5 21 7 20 C14.5 19 17 16.5 18 9Z"/>` +
  `<path d="M28.5 7 C29 9.6 29.9 10.5 32.5 11 C29.9 11.5 29 12.4 28.5 15 C28 12.4 27.1 11.5 24.5 11 C27.1 10.5 28 9.6 28.5 7Z"/>`;

function gear(tile: string): string {
  const teeth = Array.from({ length: 8 }, (_, i) => `<rect x="17.75" y="7" width="4.5" height="6" rx="1" transform="rotate(${i * 45} 20 20)"/>`).join("");
  return `${teeth}<circle cx="20" cy="20" r="9"/><circle cx="20" cy="20" r="3.6" fill="${tile}"/>`;
}

export type GlyphActor = { id: string; kind: ActorKind; color: PaletteColor };

/** The face parts an id picks, exported so tests can check that faces vary. */
export function faceParts(seed: string): { head: number; antenna: number; ears: number; eyes: number; mouth: number } {
  let hash = glyphHash(seed);
  const pick = (count: number) => {
    const value = hash % count;
    hash = Math.floor(hash / count);
    return value;
  };
  return { head: pick(HEADS.length), antenna: pick(ANTENNAS.length), ears: pick(EARS.length), eyes: pick(EYES.length), mouth: pick(MOUTHS.length) };
}

/**
 * The glyph's SVG markup for a non-user actor. The content stays inside the
 * tile's inscribed circle, because an AvatarGroup crops every avatar round.
 */
export function agentGlyphSvg(actor: GlyphActor): string {
  const tile = FRAPPE[PALETTE_KEY_COLOURS[actor.color]];
  let body: string;
  if (actor.kind === "assistant") body = SPARKLE;
  else if (actor.kind === "system") body = gear(tile);
  else {
    const parts = faceParts(actor.id);
    const head = HEADS[parts.head];
    body = [ANTENNAS[parts.antenna], EARS[parts.ears], () => head.svg, EYES[parts.eyes], MOUTHS[parts.mouth]].map((part) => part(tile, head.top)).join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${tile}"/><g fill="${FACE}">${body}</g></svg>`;
}

/** `agentGlyphSvg` as an image URL for Avatar `src`. */
export function agentGlyphSrc(actor: GlyphActor): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(agentGlyphSvg(actor))}`;
}

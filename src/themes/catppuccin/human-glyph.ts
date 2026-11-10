/**
 * Generated avatars for people, actors of kind "user" (docs/contracts/ui.md
 * "Actors"). The organic sibling of the robot faces in `agent-glyph.ts`: the
 * same 40x40 viewBox, flat style, palette tile and crust ink, but where a robot
 * is a dark rectangle with cut-out eyes, a person is a light face framed by dark
 * hair, over dark shoulders, drawn only from circles and soft curves. That light
 * face against the robots' dark one tells a person from a bot even at 16px,
 * where Astryx's 8px `--radius-element` makes a bot tile look round too.
 *
 * Hair, eyes and mouth are picked by the robots' FNV-1a hash of the id, so a
 * second person looks different from the first even in the same colour and
 * keeps the look when renamed. The local user ("You") lands on the calm swept
 * hair, dot eyes and smile; tests/ui/human-glyph.test.ts pins that, so adding a
 * part never silently changes the user's face. The face is one fixed Frappé
 * rosewater on every tile (a stylised tone, not a skin tone), with faint Frappé
 * red cheeks that only show from 24px.
 *
 * Meant for the round (circle) Avatar. The figure is clipped to the tile's
 * inscribed circle inside the SVG, so the shoulders end on the circle like a
 * portrait and an AvatarGroup's round crop changes nothing. As with the robots,
 * the SVG reaches Avatar as a data URI and cannot read theme tokens.
 */
import type { PaletteColor } from "@/lib/tessera/types";
import { glyphHash } from "./agent-glyph";
import { FRAPPE, PALETTE_KEY_COLOURS } from "./palette";

/** Hair, shoulders and features: the robots' face colour. */
const INK = FRAPPE.crust;
/** The face: Catppuccin's warm off-white, light on every Frappé hue. */
const FACE = FRAPPE.rosewater;
/** The figure is drawn at this scale about (20, 19), so the face fills the tile about as much as a robot face does. */
const SCALE = 1.15;

/* Head: centre (20, 18), radius 7.6, so top 10.4, chin 25.6, sides 12.4 and 27.6. */
const HEAD = `<circle cx="20" cy="18" r="7.6" fill="${FACE}"/>`;
/** Shoulders: a soft dome that runs out through the bottom of the circle (the clip ends it). Always the first figure element. */
const SHOULDERS = `<path d="M5.5 40 L5.5 36.6 C5.5 31.4 11.6 28.6 20 28.6 C28.4 28.6 34.5 31.4 34.5 36.6 L34.5 40 Z"/>`;
/** A light V-neck that joins head and shoulders. */
const NECK = `<path d="M17.4 24 L22.6 24 L22.6 28.6 L20 31.6 L17.4 28.6 Z" fill="${FACE}"/>`;

/** A hair style: `back` is drawn behind the head (the silhouette), `front` over it. */
type Hair = { back: string; front: string };

const CROP = `<path d="M12.1 17.2 C11.6 11.8 15.2 9.4 20 9.4 C24.8 9.4 28.4 11.8 27.9 17.2 C27 15.4 25.6 14.4 23.8 14 C21.2 14.7 18.8 14.7 16.2 14 C14.4 14.4 13 15.4 12.1 17.2 Z"/>`;

const HAIRS: Hair[] = [
  { back: "", front: CROP },
  // swept: the user's hair (index pinned by the test)
  {
    back: "",
    front: `<path d="M12.1 17.8 C11.4 11.6 15.2 9 20.4 9 C25.8 9 28.8 12 27.9 17.6 C27.2 15.6 26 14.2 24.6 13.4 C21.8 15.8 17.4 16.6 13.6 15.4 C12.9 16.1 12.4 16.9 12.1 17.8 Z"/>`,
  },
  // bun
  { back: `<circle cx="20" cy="7.4" r="3.6"/>`, front: CROP },
  // curls
  {
    back:
      `<circle cx="12.6" cy="14.6" r="3.3"/><circle cx="14.6" cy="10.6" r="3.5"/><circle cx="19" cy="8.4" r="3.7"/>` +
      `<circle cx="23.6" cy="9" r="3.6"/><circle cx="26.8" cy="12" r="3.4"/><circle cx="27.6" cy="15.6" r="3"/>`,
    front: `<path d="M12.3 16.6 C12.6 13.4 15.6 11.6 20 11.6 C24.4 11.6 27.4 13.4 27.7 16.6 C26.2 15.2 24.8 14.6 23.2 14.6 C22.2 15.4 21 15.6 20 15 C19 15.6 17.8 15.4 16.8 14.6 C15.2 14.6 13.8 15.2 12.3 16.6 Z"/>`,
  },
  // long
  {
    back: `<path d="M11.6 17 C11 10.6 15 8.8 20 8.8 C25 8.8 29 10.6 28.4 17 L29.6 28 C27.6 29 25.4 29 23.6 28.2 L23.6 22 L16.4 22 L16.4 28.2 C14.6 29 12.4 29 10.4 28 Z"/>`,
    front: `<path d="M12.2 18.6 C11.8 12.4 15.2 9.6 20 9.6 C24.8 9.6 28.2 12.4 27.8 18.6 C25.2 17.8 22.4 16.2 20.4 13.6 C18.6 16.2 15.6 17.8 12.2 18.6 Z"/>`,
  },
  // ponytail
  {
    back: `<path d="M25.8 11.4 C30.8 10.8 32.8 14.8 31.8 20.6 C31.2 23.4 29.8 24.8 28.4 25.4 C29.2 22.2 29 18.8 27.2 15.6 Z"/>`,
    front: `<path d="M12.1 17.4 C11.6 11.8 15.2 9.2 20.2 9.2 C24.8 9.2 28.4 11.8 27.9 16.8 C25.6 13.6 21.4 13.2 17.6 14.2 C15.4 14.8 13.4 15.8 12.1 17.4 Z"/>`,
  },
];

/** Eyes, bold enough to carry at 16px like the robots' eyes: dots (the user's), or happy arcs. */
const EYES: string[] = [
  `<circle cx="17.2" cy="19.2" r="1.55"/><circle cx="22.8" cy="19.2" r="1.55"/>`,
  `<path d="M15.7 19.9 Q17.2 17.8 18.7 19.9 M21.3 19.9 Q22.8 17.8 24.3 19.9" stroke="${INK}" stroke-width="1.4" stroke-linecap="round" fill="none"/>`,
];

/** Mouths: a smile (the user's), or a wide grin. A filled open mouth was tried and read as a beard. */
const MOUTHS: string[] = [
  `<path d="M17.4 22.4 Q20 24.7 22.6 22.4" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
  `<path d="M16.6 22 Q20 25.6 23.4 22" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,
];

const CHEEKS = `<g fill="${FRAPPE.red}" opacity="0.45"><circle cx="14.9" cy="21.8" r="1.5"/><circle cx="25.1" cy="21.8" r="1.5"/></g>`;

export type HumanGlyphActor = { id: string; color: PaletteColor };
export type HumanParts = { hair: number; eyes: number; mouth: number };

/** The parts an id picks, exported so tests can check that people vary and pin the user's face. */
export function humanParts(seed: string): HumanParts {
  let hash = glyphHash(seed);
  const pick = (count: number) => {
    const value = hash % count;
    hash = Math.floor(hash / count);
    return value;
  };
  return { hair: pick(HAIRS.length), eyes: pick(EYES.length), mouth: pick(MOUTHS.length) };
}

/** How many options each part has (tests sample every one). */
export const HUMAN_PART_COUNTS: HumanParts = { hair: HAIRS.length, eyes: EYES.length, mouth: MOUTHS.length };

/**
 * The glyph's SVG markup for a person. `parts` overrides the hashed parts
 * (tests and comparison sheets only). The tile is the actor's Frappé hue; the
 * figure sits in a group clipped to the inscribed circle (the `c` id is local
 * to each data-URI image).
 */
export function humanGlyphSvg(actor: HumanGlyphActor, parts: HumanParts = humanParts(actor.id)): string {
  const tile = FRAPPE[PALETTE_KEY_COLOURS[actor.color]];
  const hair = HAIRS[parts.hair % HAIRS.length];
  const figure = SHOULDERS + NECK + hair.back + HEAD + hair.front + EYES[parts.eyes % EYES.length] + CHEEKS + MOUTHS[parts.mouth % MOUTHS.length];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${tile}"/>` +
    `<clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath>` +
    `<g clip-path="url(#c)" fill="${INK}"><g transform="translate(20 19) scale(${SCALE}) translate(-20 -19)">${figure}</g></g></svg>`
  );
}

/** `humanGlyphSvg` as an image URL for Avatar `src`. */
export function humanGlyphSrc(actor: HumanGlyphActor): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(humanGlyphSvg(actor))}`;
}

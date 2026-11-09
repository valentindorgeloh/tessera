// @vitest-environment jsdom
/**
 * Generated avatars for non-human actors (src/themes/catppuccin/agent-glyph.ts,
 * docs/contracts/ui.md "Actors"): an agent's robot face depends only on its id,
 * different ids give different faces, the Assistant and System glyphs ignore
 * the id, every palette colour gives a well-formed SVG on its Frappé tile, and
 * the face stays inside the tile's inscribed circle because an AvatarGroup crops
 * every avatar round.
 */
import { describe, expect, it } from "vitest";
import { PaletteColorSchema } from "@/lib/tessera/schemas";
import type { PaletteColor } from "@/lib/tessera/types";
import { agentGlyphSrc, agentGlyphSvg, faceParts, type GlyphActor } from "@/themes/catppuccin/agent-glyph";
import { FRAPPE, PALETTE_KEY_COLOURS } from "@/themes/catppuccin/palette";

const IDS = Array.from({ length: 200 }, (_, i) => `actor-${i}`);

function agent(id: string, color: PaletteColor = "blue"): GlyphActor {
  return { id, kind: "agent", color };
}

/** Parses the markup as XML, failing the test on a parse error. */
function parseSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc.documentElement as unknown as SVGSVGElement;
}

describe("agentGlyphSvg", () => {
  it("draws the same face for one id every time", () => {
    for (const id of IDS.slice(0, 20)) {
      expect(agentGlyphSvg(agent(id))).toBe(agentGlyphSvg(agent(id)));
      expect(faceParts(id)).toEqual(faceParts(id));
    }
  });

  it("varies the face parts across ids", () => {
    const tuples = new Set(IDS.map((id) => Object.values(faceParts(id)).join(",")));
    expect(tuples.size).toBeGreaterThanOrEqual(100);
    expect(new Set(IDS.map((id) => agentGlyphSvg(agent(id)))).size).toBe(tuples.size);
  });

  it("ignores the id for the Assistant and System", () => {
    for (const kind of ["assistant", "system"] as const) {
      const a = agentGlyphSvg({ id: "first", kind, color: "purple" });
      const b = agentGlyphSvg({ id: "second", kind, color: "purple" });
      expect(a).toBe(b);
      expect(a).not.toBe(agentGlyphSvg(agent("first", "purple")));
    }
    expect(agentGlyphSvg({ id: "x", kind: "assistant", color: "gray" })).not.toBe(agentGlyphSvg({ id: "x", kind: "system", color: "gray" }));
  });

  it("gives every palette colour a well-formed SVG on its Frappé tile", () => {
    for (const color of PaletteColorSchema.options) {
      const hue = FRAPPE[PALETTE_KEY_COLOURS[color]];
      for (const kind of ["agent", "assistant", "system"] as const) {
        const svg = parseSvg(agentGlyphSvg({ id: "tile-check", kind, color }));
        expect(svg.tagName).toBe("svg");
        expect(svg.getAttribute("viewBox")).toBe("0 0 40 40");
        const tile = svg.firstElementChild;
        expect(tile?.tagName).toBe("rect");
        expect(tile?.getAttribute("width")).toBe("40");
        expect(tile?.getAttribute("height")).toBe("40");
        expect(tile?.getAttribute("fill")).toBe(hue);
      }
    }
  });
});

describe("agentGlyphSrc", () => {
  it("is an SVG data URI that decodes back to the markup", () => {
    for (const actor of [agent("decode-me", "teal"), { id: "a", kind: "assistant", color: "pink" } as const, { id: "s", kind: "system", color: "gray" } as const]) {
      const src = agentGlyphSrc(actor);
      const prefix = "data:image/svg+xml;utf8,";
      expect(src.startsWith(prefix)).toBe(true);
      expect(decodeURIComponent(src.slice(prefix.length))).toBe(agentGlyphSvg(actor));
    }
  });
});

/**
 * Geometry guard. Circles count with their radius and rects with their four
 * corners (a rounded rect by its bounding box, which is stricter than its
 * shape); a path counts by its points when it uses absolute commands only.
 * The gear teeth are rotated about the tile centre, which keeps their distance
 * from it, so the transform can be ignored.
 */
const CENTRE = 20;
const RADIUS = 20;

function farthestReach(svg: SVGSVGElement): number {
  const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);
  const dist = (x: number, y: number) => Math.hypot(x - CENTRE, y - CENTRE);
  let reach = 0;
  for (const circle of Array.from(svg.getElementsByTagName("circle"))) {
    reach = Math.max(reach, dist(num(circle, "cx"), num(circle, "cy")) + num(circle, "r"));
  }
  for (const rect of Array.from(svg.getElementsByTagName("rect"))) {
    if (rect === svg.firstElementChild) continue; // the tile itself
    const [x, y, w, h] = [num(rect, "x"), num(rect, "y"), num(rect, "width"), num(rect, "height")];
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) reach = Math.max(reach, dist(cx, cy));
  }
  for (const path of Array.from(svg.getElementsByTagName("path"))) {
    const d = path.getAttribute("d") ?? "";
    if (/[a-z]/.test(d)) continue; // relative commands: not resolved here
    const values = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < values.length; i += 2) reach = Math.max(reach, dist(values[i], values[i + 1]));
  }
  return reach;
}

describe("glyph geometry", () => {
  it("samples every option of every face part", () => {
    const parts = IDS.map(faceParts);
    for (const key of Object.keys(parts[0]) as (keyof (typeof parts)[0])[]) {
      const seen = new Set(parts.map((p) => p[key]));
      expect(seen.size, key).toBeGreaterThanOrEqual(2);
      expect(seen.size, key).toBe(Math.max(...seen) + 1);
    }
  });

  it("keeps every face, the sparkle and the gear inside the tile's inscribed circle", () => {
    const actors: GlyphActor[] = [...IDS.map((id) => agent(id)), { id: "a", kind: "assistant", color: "blue" }, { id: "s", kind: "system", color: "blue" }];
    for (const actor of actors) {
      expect(farthestReach(parseSvg(agentGlyphSvg(actor))), `${actor.kind} ${actor.id}`).toBeLessThanOrEqual(RADIUS);
    }
  });
});

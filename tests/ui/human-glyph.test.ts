// @vitest-environment jsdom
/**
 * Generated avatars for people (src/themes/catppuccin/human-glyph.ts,
 * docs/contracts/ui.md "Actors"): a person's bust depends only on the id, the
 * local user keeps the calm swept hair, dot eyes and smile, other people vary
 * by id, every colour is a palette hue, and the figure is clipped to the
 * tile's inscribed circle with the head and hair well inside it, because an
 * AvatarGroup crops every avatar round. ActorAvatar renders it round with the
 * actor's name as the accessible name.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { PaletteColorSchema } from "@/lib/tessera/schemas";
import type { PaletteColor } from "@/lib/tessera/types";
import { agentGlyphSrc } from "@/themes/catppuccin/agent-glyph";
import { HUMAN_PART_COUNTS, humanGlyphSrc, humanGlyphSvg, humanParts, type HumanGlyphActor } from "@/themes/catppuccin/human-glyph";
import { FRAPPE, LATTE, PALETTE_KEY_COLOURS } from "@/themes/catppuccin/palette";

const IDS = Array.from({ length: 200 }, (_, i) => `person-${i}`);

function person(id: string, color: PaletteColor = "blue"): HumanGlyphActor {
  return { id, color };
}

/** Parses the markup as XML, failing the test on a parse error. */
function parseSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
  return doc.documentElement as unknown as SVGSVGElement;
}

describe("humanGlyphSvg", () => {
  it("draws the same person for one id every time", () => {
    for (const id of [USER_ACTOR_ID, ...IDS.slice(0, 20)]) {
      expect(humanGlyphSvg(person(id))).toBe(humanGlyphSvg(person(id)));
      expect(humanParts(id)).toEqual(humanParts(id));
    }
  });

  it("pins the user's face: swept hair, dot eyes, smile", () => {
    // Guard: adding or reordering a part must not silently change "You".
    expect(humanParts(USER_ACTOR_ID)).toEqual({ hair: 1, eyes: 0, mouth: 0 });
  });

  it("varies people across ids and samples every part", () => {
    const parts = IDS.map(humanParts);
    const tuples = new Set(parts.map((p) => `${p.hair},${p.eyes},${p.mouth}`));
    const combinations = HUMAN_PART_COUNTS.hair * HUMAN_PART_COUNTS.eyes * HUMAN_PART_COUNTS.mouth;
    expect(tuples.size).toBe(combinations);
    expect(new Set(IDS.map((id) => humanGlyphSvg(person(id)))).size).toBe(combinations);
    for (const key of ["hair", "eyes", "mouth"] as const) {
      expect(new Set(parts.map((p) => p[key])).size, key).toBe(HUMAN_PART_COUNTS[key]);
    }
  });

  it("puts every palette colour on its Frappé tile and uses only palette hues", () => {
    const palette = new Set([...Object.values(FRAPPE), ...Object.values(LATTE)].map((hex) => hex.toLowerCase()));
    for (const color of PaletteColorSchema.options) {
      const markup = humanGlyphSvg(person("tile-check", color));
      const svg = parseSvg(markup);
      expect(svg.getAttribute("viewBox")).toBe("0 0 40 40");
      const tile = svg.firstElementChild;
      expect(tile?.tagName).toBe("rect");
      expect(tile?.getAttribute("width")).toBe("40");
      expect(tile?.getAttribute("fill")).toBe(FRAPPE[PALETTE_KEY_COLOURS[color]]);
      for (const hex of markup.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(palette.has(hex.toLowerCase()), hex).toBe(true);
    }
  });
});

describe("humanGlyphSrc", () => {
  it("is an SVG data URI that decodes back to the markup", () => {
    const actor = person(USER_ACTOR_ID);
    const prefix = "data:image/svg+xml;utf8,";
    const src = humanGlyphSrc(actor);
    expect(src.startsWith(prefix)).toBe(true);
    expect(decodeURIComponent(src.slice(prefix.length))).toBe(humanGlyphSvg(actor));
  });
});

/**
 * Geometry guard. Every figure element sits in a group clipped to the circle
 * (20, 20, r 20), so nothing paints outside the round crop. Inside that, the
 * head, hair and features (everything but the shoulders, the figure's first
 * element, which runs out through the bottom on purpose) must reach no farther
 * than the inscribed circle, so the clip never cuts a hair style. Points are
 * mapped through the figure's `translate scale translate` transform; circles
 * count with their radius, paths by their absolute points.
 */
function figureReach(svg: SVGSVGElement): number {
  const clip = svg.getElementsByTagName("clipPath")[0];
  const circle = clip?.firstElementChild;
  expect(circle?.tagName).toBe("circle");
  expect([circle?.getAttribute("cx"), circle?.getAttribute("cy"), circle?.getAttribute("r")]).toEqual(["20", "20", "20"]);
  const clipped = Array.from(svg.children).filter((el) => el.tagName === "g");
  expect(clipped).toHaveLength(1);
  expect(clipped[0].getAttribute("clip-path")).toBe(`url(#${clip.getAttribute("id")})`);
  // Only the tile, the clip and the clipped group sit at the top level.
  expect(Array.from(svg.children).map((el) => el.tagName)).toEqual(["rect", "clipPath", "g"]);

  const figure = clipped[0].firstElementChild as Element;
  const match = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(figure.getAttribute("transform") ?? "");
  expect(match).not.toBeNull();
  const [ox, oy, scale] = [Number(match![1]), Number(match![2]), Number(match![3])];
  const dist = (x: number, y: number) => Math.hypot(ox + scale * (x - ox) - 20, oy + scale * (y - oy) - 20);
  const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);

  const shoulders = figure.firstElementChild;
  expect(shoulders?.getAttribute("d")).toMatch(/40/);
  let reach = 0;
  for (const el of Array.from(figure.querySelectorAll("circle, path"))) {
    if (el === shoulders) continue;
    if (el.tagName === "circle") {
      reach = Math.max(reach, dist(num(el, "cx"), num(el, "cy")) + scale * num(el, "r"));
      continue;
    }
    const d = el.getAttribute("d") ?? "";
    expect(/[a-z]/.test(d), d).toBe(false);
    expect(/[HV]/.test(d), d).toBe(false);
    const values = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < values.length; i += 2) reach = Math.max(reach, dist(values[i], values[i + 1]));
  }
  return reach;
}

describe("human glyph geometry", () => {
  it("clips every person to the inscribed circle and keeps head and hair inside it", () => {
    for (let hair = 0; hair < HUMAN_PART_COUNTS.hair; hair++) {
      for (let eyes = 0; eyes < HUMAN_PART_COUNTS.eyes; eyes++) {
        for (let mouth = 0; mouth < HUMAN_PART_COUNTS.mouth; mouth++) {
          const reach = figureReach(parseSvg(humanGlyphSvg(person("geometry"), { hair, eyes, mouth })));
          expect(reach, `hair ${hair} eyes ${eyes} mouth ${mouth}`).toBeLessThanOrEqual(19.5);
        }
      }
    }
  });
});

describe("ActorAvatar", () => {
  function render(element: ReturnType<typeof createElement>): HTMLElement {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(element));
    return host;
  }

  it("draws the user as the round human glyph named You, a bot on a rounded tile, a null actor as initials", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const you = render(createElement(ActorAvatar, { actor: { id: USER_ACTOR_ID, name: "You", kind: "user", color: "blue" }, tooltip: false }));
    expect(you.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("You");
    const img = you.querySelector("img");
    expect(img?.getAttribute("src")).toBe(humanGlyphSrc({ id: USER_ACTOR_ID, color: "blue" }));

    const bot = render(createElement(ActorAvatar, { actor: { id: "bot", name: "mcp:bot", kind: "agent", color: "green" }, tooltip: false }));
    expect(bot.querySelector("img")?.getAttribute("src")).toBe(agentGlyphSrc({ id: "bot", kind: "agent", color: "green" }));

    const unknown = render(createElement(ActorAvatar, { actor: null, name: "Removed", tooltip: false }));
    expect(unknown.querySelector("img")).toBeNull();
    expect(unknown.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Removed");
  });
});

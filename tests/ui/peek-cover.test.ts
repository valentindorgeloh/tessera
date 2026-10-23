/**
 * The side peek on a container too narrow for it (src/components/detail/peek-cover.ts,
 * detail.css `.tessera-peek-panel--cover`): at 768 the content panel is about 490px, so
 * a 480px peek left the board strip 32px and the table 20px wide. Below 640px the panel
 * covers the list; the threshold is fixed, so a resize drag never flips the mode.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PEEK_COVER_BELOW, PEEK_MIN_LIST_WIDTH, coversList } from "@/components/detail/peek-cover";
import { PEEK_MIN_WIDTH } from "@/components/detail/peek-prefs";

describe("coversList", () => {
  it("covers the list on a phone and on a tablet with the sidebar open", () => {
    expect(coversList(343)).toBe(true);
    expect(coversList(488)).toBe(true); // 768 viewport
    expect(coversList(632)).toBe(true); // 900 viewport
  });

  it("keeps the list beside the panel once it can hold the minimum panel plus a usable list", () => {
    expect(PEEK_COVER_BELOW).toBe(PEEK_MIN_WIDTH + PEEK_MIN_LIST_WIDTH);
    expect(coversList(PEEK_COVER_BELOW - 1)).toBe(true);
    expect(coversList(PEEK_COVER_BELOW)).toBe(false);
    expect(coversList(744)).toBe(false); // 1024 viewport
    expect(coversList(1160)).toBe(false);
  });

  it("does not cover before the container is measured", () => {
    expect(coversList(0)).toBe(false);
  });
});

describe("cover stylesheet", () => {
  const css = readFileSync(path.join(process.cwd(), "src/components/styles/detail.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes the covering panel fill its container", () => {
    const rule = /\.tessera-peek-panel--cover\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/min-width:\s*100%/);
  });
});

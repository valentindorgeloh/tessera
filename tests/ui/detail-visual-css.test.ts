/**
 * Visual-audit fixes of the detail lane, read from the stylesheets (jsdom runs
 * no CSS layout; the live measurements are in the lane report): the version
 * history list column and its stacking, the sub-item row wrap, the property
 * rail's row structure and sticky column, the title pencil, the comment
 * avatar, the digest card inset, and the 44px touch rules that exist only
 * under "(pointer: coarse), (max-width: 480px)" (decision 14), so no 1440
 * density changed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = (name: string) => read(`src/components/styles/${name}`).replace(/\/\*[\s\S]*?\*\//g, "");

type Block = { prelude: string; body: string };

/** The blocks at one nesting level of `source`. */
function blocks(source: string): Block[] {
  const found: Block[] = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) {
        prelude = source.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        found.push({ prelude, body: source.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return found;
}

/** The declarations of the top-level rule whose selector list is exactly `selector`. */
function topRule(source: string, selector: string): string {
  const block = blocks(source).find((candidate) => candidate.prelude.replace(/\s+/g, " ") === selector);
  if (!block) throw new Error(`no top-level rule for ${selector}`);
  return block.body;
}

const TOUCH = "@media (pointer: coarse), (max-width: 480px)";

/** The rules inside the touch media block of `source`. */
function touchRules(source: string): Block[] {
  const media = blocks(source).find((candidate) => candidate.prelude === TOUCH);
  if (!media) throw new Error(`no ${TOUCH} block`);
  return blocks(media.body);
}

const touchRule = (source: string, selector: string): string => {
  const rule = touchRules(source).find((candidate) => candidate.prelude.replace(/\s+/g, " ") === selector);
  if (!rule) throw new Error(`no touch rule for ${selector}`);
  return rule.body;
};

describe("version history panes (D1)", () => {
  const history = css("history.css");

  it("gives the list a fixed 160 to 240px column and the diff the rest", () => {
    const list = topRule(history, ".tessera-history-list");
    expect(list).toMatch(/flex:\s*0 0 clamp\(calc\(var\(--spacing-12\) \* 3 \+ var\(--spacing-4\)\),\s*30%,\s*calc\(var\(--spacing-12\) \* 5\)\)/);
    expect(topRule(history, ".tessera-history-diff")).toMatch(/flex:\s*1 1 0/);
    expect(topRule(history, ".tessera-history-pane")).toMatch(/min-width:\s*0/);
  });

  it("stacks the panes below 600px, the list on top and capped at four rows", () => {
    const narrow = blocks(history).find((block) => block.prelude === "@media (max-width: 599px)");
    expect(narrow).toBeDefined();
    const inner = blocks(narrow?.body ?? "");
    expect(inner.find((rule) => rule.prelude === ".tessera-history-split")?.body).toMatch(/flex-direction:\s*column/);
    const list = inner.find((rule) => rule.prelude === ".tessera-history-list")?.body ?? "";
    expect(list).toMatch(/max-height:\s*calc\(var\(--spacing-12\) \* 4\)/);
    expect(list).toMatch(/flex:\s*0 0 auto/);
  });
});

describe("sub-item rows (D2)", () => {
  const detail = css("detail.css");

  it("lets the properties shrink and wrap under the name instead of squeezing it", () => {
    expect(topRule(detail, ".tessera-detail-row")).toMatch(/flex-wrap:\s*wrap/);
    expect(topRule(detail, ".tessera-detail-row-name")).toMatch(/min-width:\s*min\(10rem,\s*100%\)/);
    const props = topRule(detail, ".tessera-detail-row-props");
    expect(props).toMatch(/flex:\s*0 1 auto/);
    expect(props).toMatch(/min-width:\s*0/);
    expect(props).toMatch(/margin-inline-start:\s*auto/);
  });
});

describe("property rail rows (D4, D9)", () => {
  const detail = css("detail.css");

  it("gives label and value one height, centred, with the baseline grid alignment switched off", () => {
    expect(topRule(detail, ".tessera-detail-rail")).toMatch(/--tessera-rail-row:\s*var\(--size-element-md\)/);
    const cells = topRule(detail, ".tessera-detail-rail dt, .tessera-detail-rail dd");
    expect(cells).toMatch(/align-items:\s*center/);
    expect(cells).toMatch(/min-block-size:\s*var\(--tessera-rail-row\)/);
    expect(topRule(detail, ".tessera-detail-rail dl")).toMatch(/align-items:\s*start/);
  });

  it("pulls the ghost controls back by their 12px padding so the value texts share one start", () => {
    const pull = topRule(detail, '.tessera-detail-rail .astryx-field > [data-variant="ghost"], .tessera-detail-rail .tessera-detail-subscribe');
    expect(pull).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--spacing-3\)\)/);
  });

  it("sticks the properties under the pinned header on the full page, keeping the rail's hairline full height", () => {
    const container = blocks(detail).find((block) => block.prelude === "@container detail (min-width: 960px)");
    const inner = blocks(container?.body ?? "");
    const sticky = inner.find((rule) => rule.prelude === ".tessera-detail--page .tessera-detail-rail > .tessera-detail-props")?.body ?? "";
    expect(sticky).toMatch(/position:\s*sticky/);
    expect(sticky).toMatch(/inset-block-start:\s*calc\(var\(--spacing-11\) \+ var\(--spacing-4\)\)/);
    expect(sticky).toMatch(/overflow-y:\s*auto/);
    expect(sticky).toMatch(/padding:\s*var\(--spacing-1\)/);
    expect(sticky).toMatch(/margin:\s*calc\(-1 \* var\(--spacing-1\)\)/);
    expect(inner.find((rule) => rule.prelude === ".tessera-detail--page .tessera-detail-rail")?.body).toMatch(/align-self:\s*stretch/);
  });
});

describe("title pencil (D8)", () => {
  const detail = css("detail.css");

  it("sits right after the title, not at the row's end, with no offset of its own", () => {
    expect(topRule(detail, ".tessera-detail-title")).toMatch(/flex:\s*0 1 auto/);
    expect(topRule(detail, ".tessera-detail-title-edit")).not.toMatch(/margin-block-start/);
  });
});

describe("comment avatar (D11)", () => {
  it("centres the 24px avatar on the activity hairline (2px in, 2px back)", () => {
    expect(topRule(css("collaboration.css"), ".tessera-comment-avatar")).toMatch(/margin-inline:\s*var\(--spacing-0-5\) calc\(-1 \* var\(--spacing-0-5\)\)/);
  });
});

describe("digest card inset (D16)", () => {
  const surfaces = css("ai-surfaces.css");

  it("keeps the inbox margins on the inset variant only", () => {
    expect(topRule(surfaces, ".tessera-ai-digest")).not.toMatch(/margin/);
    const inset = topRule(surfaces, ".tessera-ai-digest--inset");
    expect(inset).toMatch(/margin-inline:\s*var\(--spacing-4\)/);
    expect(inset).toMatch(/margin-block:\s*var\(--spacing-4\) var\(--spacing-2\)/);
  });
});

describe("assistant composer (D12)", () => {
  it("is flat with Astryx's emphasized border (accent while focused) rather than a shadow", () => {
    expect(read("src/components/ai/AssistantPanel.tsx")).toMatch(/<ChatComposer[^>]*elevation="none"/);
  });
});

describe("touch targets (D3, decision 14)", () => {
  it("keeps the rail triggers and date fields at their drawn size (hit area from the theme and shell.css), raises list rows to 44px, and gives the crumbs a hit area", () => {
    const detail = css("detail.css");
    expect(topRule(detail, ".tessera-detail-rail")).not.toMatch(/spacing-11/);
    expect(detail).not.toMatch(/--tessera-rail-row:\s*var\(--spacing-11\)/);
    expect(detail).not.toMatch(/\.tessera-detail button\[role="combobox"\]/);
    expect(detail).not.toMatch(/\.astryx-date-input/);
    expect(touchRule(detail, ".tessera-detail-row")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    // A list row's name link is a 44px box inside its 44px row; the crumbs keep their line and carry a pseudo-element area (a 44px box wrapped them and made the pinned header 80px).
    expect(touchRule(detail, ".tessera-detail-row-name a")).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(touchRule(detail, ".tessera-detail-crumbs a, .tessera-detail-crumbs button")).toMatch(/position:\s*relative/);
    const area = touchRule(detail, ".tessera-detail-crumbs a::before, .tessera-detail-crumbs button::before");
    expect(area).toMatch(/inset-block:\s*min\(0px, calc\(\(100% - var\(--spacing-11\)\) \/ 2\)\)/);
    expect(touchRule(detail, ".tessera-detail-crumbs a, .tessera-detail-crumbs button")).not.toMatch(/min-block-size/);
  });

  it("raises the assistant composer's text area to 44px only under the touch query", () => {
    const panel = css("ai-panel.css");
    expect(touchRule(panel, '.tessera-ai-panel [role="textbox"]')).toMatch(/min-block-size:\s*var\(--spacing-11\)/);
    expect(panel.replace(/@media[^{]*\{[\s\S]*$/, "")).not.toMatch(/role="textbox"/);
  });
});

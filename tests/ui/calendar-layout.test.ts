// @vitest-environment jsdom
/**
 * Calendar layout (src/components/work-items/CalendarLayout.tsx) under jsdom
 * (visual audit, timeline):
 * - only a chip that can be dragged carries `data-draggable` (calendar.css gives
 *   the grab cursor to that alone); a read-only chip has no Move control and no
 *   grab cursor, but a click still opens the peek (pointer cursor);
 * - the "+N more" button keeps "+N more" as its accessible name while its visible
 *   text splits into the count and a word that narrow cells hide;
 * - the quarter zoom (decision 139): 13 or 14 week rows, muted days outside the
 *   quarter, "Nov 1" labels, two chips per cell, and only a "+N" count per cell
 *   when the calendar is narrower than 600px (a ResizeObserver stub reports it);
 * - closed popovers mount no content (docs/field-guide/performance.md).
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { WorkItem } from "@/lib/tessera/types";
import type { Display } from "@/lib/tessera/types";
import type { ProjectBundle } from "@/components/work-items/types";

/** The page's query string (`?cal=` anchors the period); each test sets it, `afterEach` clears it. */
const nav = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

/** ResizeObserver stub: `resizeCalendar(width)` reports a content-box width to the observers of the calendar root. */
type ObserverEntry = { callback: ResizeObserverCallback; target: Element | null; self: ResizeObserver };
const observers: ObserverEntry[] = [];

const { CalendarLayout } = await import("@/components/work-items/CalendarLayout");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const PROJECT = "11111111-1111-7111-8111-111111111111";
const STATE = "66666666-6666-7666-8666-666666666666";
const NOW = "2026-10-11T10:00:00.000Z";
const audit = { created_at: NOW, updated_at: NOW, created_by: "u", updated_by: "u", deleted_at: null };

function item(sequence: number, target: string): WorkItem {
  return {
    id: `00000000-0000-7000-8000-00000000000${sequence}`,
    project_id: PROJECT,
    sequence_id: sequence,
    key: `WEB-${sequence}`,
    name: `Item ${sequence}`,
    description_md: "",
    description_version: 0,
    state_id: STATE,
    priority: "none",
    parent_id: null,
    cycle_id: null,
    estimate_point_id: null,
    start_date: null,
    target_date: target,
    completed_at: null,
    archived_at: null,
    is_draft: false,
    sort_order: "a0",
    external_source: null,
    external_id: null,
    label_ids: [],
    module_ids: [],
    assignee_ids: [],
    sub_items_count: 0,
    links_count: 0,
    intake: null,
    ...audit,
  };
}

const bundle = {
  project: { id: PROJECT, name: "Website", identifier: "WEB" },
  states: [],
  labels: [],
  cycles: [],
  modules: [],
  actors: [],
  cursor: 1,
  today: "2026-10-17",
  estimate: null,
  intake_open: 0,
  projects: [],
  week_start: 1,
} as unknown as ProjectBundle;

/** Six items on one day: four chips in the cell and "+2 more". */
const items = [1, 2, 3, 4, 5, 6].map((n) => item(n, "2026-10-17"));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function calendar(
  readOnly: boolean,
  onOpen: (id: string) => void = vi.fn(),
  options: { display?: Display; items?: WorkItem[]; onQuickAdd?: ComponentProps<typeof CalendarLayout>["onQuickAdd"] } = {},
): ReactNode {
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  const shown = options.items ?? items;
  return createElement(
    ProjectScope,
    scopeProps,
    createElement(CalendarLayout, {
      result: { items: shown, total: shown.length, cursor: 1, relations: [] },
      display: options.display ?? DEFAULT_DISPLAY,
      bundle,
      onMove: vi.fn(),
      onUpdate: vi.fn(),
      onOpen,
      onQuickAdd: options.onQuickAdd,
      readOnly,
    }),
  );
}

function zoom(layout: Display["calendar"]["layout"]): Display {
  return { ...DEFAULT_DISPLAY, layout: "calendar", calendar: { layout, show_weekends: true } };
}

async function resizeCalendar(width: number) {
  await act(async () => {
    for (const entry of observers) {
      if (entry.target instanceof HTMLElement && entry.target.classList.contains("tessera-cal")) {
        entry.callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], entry.self);
      }
    }
  });
}

/** The day cell of `day`, found through its quick-add button (render with `onQuickAdd`). */
function cellOf(el: HTMLElement, day: string): HTMLElement | null {
  return el.querySelector(`button[aria-label="Add on ${day}"]`)?.closest<HTMLElement>(".tessera-cal-day") ?? null;
}

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  class ResizeObserverStub {
    private readonly entries: ObserverEntry[] = [];
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const entry = { callback: this.callback, target, self: this as unknown as ResizeObserver };
      this.entries.push(entry);
      observers.push(entry);
    }
    unobserve() {}
    disconnect() {
      for (const entry of this.entries) observers.splice(observers.indexOf(entry), 1);
      this.entries.length = 0;
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  nav.search = "";
  observers.length = 0;
});

describe("calendar chips", () => {
  const inCell = ".tessera-cal-day > .tessera-cal-item .tessera-cal-open";

  it("marks a chip draggable only when the calendar can move it", async () => {
    const el = await render(calendar(false));
    const chips = [...el.querySelectorAll(inCell)];
    expect(chips).toHaveLength(4);
    expect(chips.every((chip) => chip.hasAttribute("data-draggable"))).toBe(true);
    // The closed "+2 more" popover mounts nothing; opened, its two chips are not dragged anywhere.
    expect(el.ownerDocument.querySelectorAll(".tessera-cal-open")).toHaveLength(4);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("button.tessera-cal-overflow")?.click();
    });
    const all = [...el.ownerDocument.querySelectorAll(".tessera-cal-open")];
    expect(all).toHaveLength(6);
    expect(all.filter((chip) => !chip.hasAttribute("data-draggable"))).toHaveLength(2);
  });

  it("leaves a read-only chip without the draggable mark (no grab cursor) and without a Move control", async () => {
    const el = await render(calendar(true));
    const chips = [...el.querySelectorAll(".tessera-cal-open")];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.some((chip) => chip.hasAttribute("data-draggable"))).toBe(false);
    expect(el.querySelector(".tessera-cal-move")).toBeNull();
    expect(el.querySelector('[aria-label^="Move WEB-"]')).toBeNull();
  });

  it("still opens the peek from a read-only chip, which is why it shows the pointer cursor", async () => {
    const onOpen = vi.fn();
    const el = await render(calendar(true, onOpen));
    const chip = el.querySelector<HTMLElement>('.tessera-cal-open[aria-label="WEB-1 Item 1"]');
    expect(chip).not.toBeNull();
    await act(async () => {
      chip?.click();
    });
    expect(onOpen).toHaveBeenCalledWith("00000000-0000-7000-8000-000000000001");
  });

  it("opens the peek from a tap on an editable chip too (the touch path to the Due date field) and offers Move to date by button", async () => {
    const onOpen = vi.fn();
    const el = await render(calendar(false, onOpen));
    await act(async () => {
      el.querySelector<HTMLElement>('.tessera-cal-open[aria-label="WEB-2 Item 2"]')?.click();
    });
    expect(onOpen).toHaveBeenCalledWith("00000000-0000-7000-8000-000000000002");
    expect(el.querySelector('button[aria-label="Move WEB-2 to date"]')).not.toBeNull();
  });
});

describe("calendar +N more button", () => {
  it("is named '+2 more' and shows the count and a hideable word", async () => {
    const el = await render(calendar(false));
    const button = el.querySelector<HTMLButtonElement>("button.tessera-cal-overflow");
    expect(button).not.toBeNull();
    expect(button?.textContent?.trim()).toBe("+2 more");
    expect(button?.getAttribute("aria-label") ?? button?.textContent?.trim()).toContain("+2 more");
    const word = button?.querySelector(".tessera-cal-overflow-word");
    expect(word?.textContent?.trim()).toBe("more");
  });
});

describe("calendar popovers mount their content only while open", () => {
  it("renders no Move to date field while its popover is closed", async () => {
    await render(calendar(false));
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Move to date");
  });
});

describe("calendar quarter zoom (decision 139)", () => {
  /** Three items on Mon Nov 2 and one on Tue Nov 3. */
  const quarterItems = [item(1, "2026-11-02"), item(2, "2026-11-02"), item(3, "2026-11-02"), item(4, "2026-11-03")];

  async function quarter() {
    nav.search = "cal=2026-11-10";
    return render(calendar(false, vi.fn(), { display: zoom("quarter"), items: quarterItems, onQuickAdd: vi.fn() }));
  }

  it("draws Q4 2026 as 14 week rows with month labels and muted days outside the quarter", async () => {
    const el = await quarter();
    expect(el.querySelector("h3")?.textContent).toBe("Q4 2026 (Oct – Dec)");
    expect(el.querySelector(".tessera-cal")?.getAttribute("data-view")).toBe("quarter");
    expect(el.querySelectorAll(".tessera-cal-week")).toHaveLength(14);
    expect([...el.querySelectorAll(".tessera-cal-num")].map((num) => num.textContent)).toContain("Nov 1");
    expect(cellOf(el, "2026-09-28")?.hasAttribute("data-outside")).toBe(true);
    expect(cellOf(el, "2026-10-01")?.hasAttribute("data-outside")).toBe(false);
    expect(cellOf(el, "2027-01-03")?.hasAttribute("data-outside")).toBe(true);
    expect(el.querySelector('button[aria-label="Previous quarter"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Next quarter"]')).not.toBeNull();
  });

  it("shows two chips per cell before '+N more'", async () => {
    const el = await quarter();
    const cell = cellOf(el, "2026-11-02");
    expect(cell?.querySelectorAll(":scope > .tessera-cal-item")).toHaveLength(2);
    const overflow = cell?.querySelector<HTMLButtonElement>("button.tessera-cal-overflow");
    expect(overflow?.textContent?.trim()).toBe("+1 more");
  });

  it("shows only a '+N' count per cell when the calendar is narrower than 600px", async () => {
    const el = await quarter();
    await resizeCalendar(500);
    expect(el.querySelectorAll(".tessera-cal-day .tessera-cal-item")).toHaveLength(0);
    const three = cellOf(el, "2026-11-02")?.querySelector<HTMLButtonElement>("button.tessera-cal-overflow");
    expect(three?.getAttribute("aria-label")).toBe("3 work items on 2026-11-02");
    expect(three?.textContent?.trim()).toBe("+3");
    const one = cellOf(el, "2026-11-03")?.querySelector<HTMLButtonElement>("button.tessera-cal-overflow");
    expect(one?.getAttribute("aria-label")).toBe("1 work item on 2026-11-03");
    // Wide again: the chips come back.
    await resizeCalendar(800);
    expect(cellOf(el, "2026-11-02")?.querySelectorAll(":scope > .tessera-cal-item")).toHaveLength(2);
  });
});

describe("calendar week and month zoom (unchanged by the quarter)", () => {
  const sixOnOct1 = [1, 2, 3, 4, 5, 6].map((n) => item(n, "2026-10-01"));

  it("keeps four chips before '+N more' and mutes days outside the anchor's month in the week", async () => {
    nav.search = "cal=2026-10-01";
    const el = await render(calendar(false, vi.fn(), { display: zoom("week"), items: sixOnOct1, onQuickAdd: vi.fn() }));
    expect(el.querySelectorAll(".tessera-cal-week")).toHaveLength(1);
    expect(cellOf(el, "2026-09-28")?.hasAttribute("data-outside")).toBe(true);
    expect(cellOf(el, "2026-10-01")?.hasAttribute("data-outside")).toBe(false);
    expect(cellOf(el, "2026-10-01")?.querySelectorAll(":scope > .tessera-cal-item")).toHaveLength(4);
    expect(el.querySelector("button.tessera-cal-overflow")?.textContent?.trim()).toBe("+2 more");
    // A narrow week keeps its chips: the count-only cell is the quarter's alone.
    await resizeCalendar(500);
    expect(cellOf(el, "2026-10-01")?.querySelectorAll(":scope > .tessera-cal-item")).toHaveLength(4);
  });

  it("keeps four chips before '+N more' and plain day numbers in the month", async () => {
    nav.search = "cal=2026-10-01";
    const el = await render(calendar(false, vi.fn(), { display: zoom("month"), items: sixOnOct1, onQuickAdd: vi.fn() }));
    expect(el.querySelectorAll(".tessera-cal-week")).toHaveLength(5);
    expect(cellOf(el, "2026-10-01")?.querySelectorAll(":scope > .tessera-cal-item")).toHaveLength(4);
    expect(el.querySelector("button.tessera-cal-overflow")?.textContent?.trim()).toBe("+2 more");
    expect([...el.querySelectorAll(".tessera-cal-num")].map((num) => num.textContent)).not.toContain("Nov 1");
    expect(el.querySelector('button[aria-label="Previous month"]')).not.toBeNull();
  });
});

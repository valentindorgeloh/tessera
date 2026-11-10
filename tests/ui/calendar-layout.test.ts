// @vitest-environment jsdom
/**
 * Calendar layout (src/components/work-items/CalendarLayout.tsx) under jsdom
 * (visual audit, timeline):
 * - only a chip that can be dragged carries `data-draggable` (calendar.css gives
 *   the grab cursor to that alone); a read-only chip has no Move control and no
 *   grab cursor, but a click still opens the peek (pointer cursor);
 * - the "+N more" button keeps "+N more" as its accessible name while its visible
 *   text splits into the count and a word that narrow cells hide.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY } from "@/lib/tessera/schemas";
import type { WorkItem } from "@/lib/tessera/types";
import type { ProjectBundle } from "@/components/work-items/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/p/work-items",
  useSearchParams: () => new URLSearchParams(""),
}));

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

function calendar(readOnly: boolean, onOpen: (id: string) => void = vi.fn()): ReactNode {
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(
    ProjectScope,
    scopeProps,
    createElement(CalendarLayout, {
      result: { items, total: items.length, cursor: 1, relations: [] },
      display: DEFAULT_DISPLAY,
      bundle,
      onMove: vi.fn(),
      onUpdate: vi.fn(),
      onOpen,
      readOnly,
    }),
  );
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
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
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
});

describe("calendar chips", () => {
  const inCell = ".tessera-cal-day > .tessera-cal-item .tessera-cal-open";

  it("marks a chip draggable only when the calendar can move it", async () => {
    const el = await render(calendar(false));
    const chips = [...el.querySelectorAll(inCell)];
    expect(chips).toHaveLength(4);
    expect(chips.every((chip) => chip.hasAttribute("data-draggable"))).toBe(true);
    // The "+2 more" popover mounts its chips only while open (closed surfaces render nothing); they are not dragged anywhere.
    expect(el.querySelectorAll(".tessera-cal-open")).toHaveLength(4);
    await act(async () => {
      el.querySelector<HTMLButtonElement>("button.tessera-cal-overflow")?.click();
    });
    const all = [...document.querySelectorAll(".tessera-cal-open")];
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

// @vitest-environment jsdom
/**
 * The compact DateControl (the date chip of list rows, table cells and the create
 * dialog) mounts its DateInput only while its popover is open. Astryx 0.6.8
 * Popover keeps closed content mounted, so an always-rendered picker put two full
 * calendars in every row of a long list. DateInput is replaced by a stub that
 * renders a marker and records its props; the marker count is the number of
 * mounted pickers.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";

const dateInputProps: Record<string, unknown>[] = [];

vi.mock("@astryxdesign/core/DateInput", () => ({
  DateInput: (props: Record<string, unknown>) => {
    dateInputProps.push(props);
    return createElement("input", { "data-date-input-stub": "", "aria-label": String(props.label ?? "") });
  },
}));

const { DateControl } = await import("@/components/work-items/properties/DateControl");
const { ProjectScope } = await import("@/components/work-items/project-provider");

const bundle = {
  project: { id: "11111111-1111-7111-8111-111111111111", name: "Website", identifier: "WEB" },
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
  week_start: 2,
} as unknown as ProjectBundle;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function inProject(node: ReactNode) {
  // createElement's typing wants `children` in the props object, the lint rule wants it as an argument; the cast satisfies both.
  const scopeProps = { bundle } as ComponentProps<typeof ProjectScope>;
  return createElement(ProjectScope, scopeProps, node);
}

/** Pickers mounted anywhere in the document (Astryx may render popover content outside the container). */
const mounted = () => document.querySelectorAll("[data-date-input-stub]").length;
const last = () => dateInputProps[dateInputProps.length - 1];
const chip = (el: HTMLElement) => {
  const button = el.querySelector<HTMLButtonElement>("button.tessera-wi-chip");
  if (!button) throw new Error("no date chip");
  return button;
};

/**
 * The picker unmounts while it holds focus, so only Astryx's focus trap brings focus back to the chip,
 * one frame after the close; the auto-focus into an opened popover also waits a frame.
 */
async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  dateInputProps.length = 0;
});

describe("compact DateControl", () => {
  const props = { value: "2026-10-20", onChange: () => {}, compact: true, label: "Target date", min: "2026-10-12", max: "2026-11-30" };

  it("mounts no picker while closed", async () => {
    const el = await render(inProject(createElement(DateControl, props)));
    expect(chip(el)).toBeTruthy();
    expect(mounted()).toBe(0);
    expect(dateInputProps).toHaveLength(0);
  });

  it("mounts one picker on a click on the chip, with min, max and the week start", async () => {
    const el = await render(inProject(createElement(DateControl, props)));
    await act(async () => {
      chip(el).click();
    });
    expect(mounted()).toBe(1);
    expect(last()).toMatchObject({ label: "Target date", value: "2026-10-20", min: "2026-10-12", max: "2026-11-30", weekStartsOn: 2 });
  });

  it("unmounts the picker again on Escape and returns focus to the chip", async () => {
    const el = await render(inProject(createElement(DateControl, props)));
    chip(el).focus();
    await act(async () => {
      chip(el).click();
    });
    await nextFrame();
    expect(mounted()).toBe(1);
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await nextFrame();
    expect(mounted()).toBe(0);
    expect(chip(el).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chip(el));
  });

  it("unmounts the picker once a date is picked, sends the date and returns focus to the chip", async () => {
    const onChange = vi.fn();
    const el = await render(inProject(createElement(DateControl, { ...props, onChange })));
    chip(el).focus();
    await act(async () => {
      chip(el).click();
    });
    await nextFrame();
    document.querySelector<HTMLInputElement>("[data-date-input-stub]")?.focus();
    const pick = last()?.onChange as (next: string | null) => void;
    await act(async () => {
      pick("2026-10-28");
    });
    await nextFrame();
    expect(onChange).toHaveBeenCalledWith("2026-10-28");
    expect(mounted()).toBe(0);
    expect(document.activeElement).toBe(chip(el));
  });
});

describe("full DateControl (detail and peek property panels)", () => {
  it("renders its DateInput at once", async () => {
    await render(inProject(createElement(DateControl, { value: null, onChange: () => {}, label: "Start date", max: "2026-11-30" })));
    expect(mounted()).toBe(1);
    expect(last()).toMatchObject({ label: "Start date", max: "2026-11-30", weekStartsOn: 2 });
  });
});

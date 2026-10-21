// @vitest-environment jsdom
/**
 * Every Astryx date picker reads the workspace's first weekday from the same
 * `useWeekStart` hook (the project bundle's `week_start` until the settings
 * store has published, the store after): DateControl (DateInput), CycleDialog
 * (DateRangeInput) and the inbox's SnoozeDialog (DateTimeInput). The pickers
 * are replaced by stubs that record their props. The store is module state, so
 * the cases run in order: before a publish, then after one.
 */
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProjectBundle } from "@/components/work-items/types";

const dateInputProps: Record<string, unknown>[] = [];
const rangeInputProps: Record<string, unknown>[] = [];
const dateTimeInputProps: Record<string, unknown>[] = [];

vi.mock("@/app/actions/cycles", () => ({
  createCycleAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })),
  updateCycleAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })),
}));
vi.mock("@astryxdesign/core/DateInput", () => ({
  DateInput: (props: Record<string, unknown>) => {
    dateInputProps.push(props);
    return null;
  },
}));
vi.mock("@astryxdesign/core/DateRangeInput", () => ({
  DateRangeInput: (props: Record<string, unknown>) => {
    rangeInputProps.push(props);
    return null;
  },
}));
vi.mock("@astryxdesign/core/DateTimeInput", () => ({
  DateTimeInput: (props: Record<string, unknown>) => {
    dateTimeInputProps.push(props);
    return null;
  },
}));

const { DateControl } = await import("@/components/work-items/properties/DateControl");
const { CycleDialog } = await import("@/components/planning/CycleDialog");
const { SnoozeDialog } = await import("@/components/inbox/SnoozeDialog");
const { ProjectScope } = await import("@/components/work-items/project-provider");
const { publishWorkspaceSettings } = await import("@/components/workspace-settings/workspace-settings-store");

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
  week_start: 0,
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

const noop = () => {};
const last = (rows: Record<string, unknown>[]) => rows[rows.length - 1];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
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
  rangeInputProps.length = 0;
  dateTimeInputProps.length = 0;
});

describe("week start before the settings store has published", () => {
  it("DateControl passes the bundle's week start to its DateInput", async () => {
    await render(inProject(createElement(DateControl, { value: "2026-10-20", onChange: noop })));
    expect(last(dateInputProps)?.weekStartsOn).toBe(0);
  });

  it("DateControl passes it in the compact popover form too", async () => {
    const el = await render(inProject(createElement(DateControl, { value: "2026-10-20", onChange: noop, compact: true })));
    const trigger = el.querySelector("button");
    await act(async () => {
      trigger?.click();
    });
    expect(last(dateInputProps)?.weekStartsOn).toBe(0);
  });

  it("CycleDialog passes it to its DateRangeInput", async () => {
    await render(inProject(createElement(CycleDialog, { projectId: bundle.project.id, isOpen: true, onOpenChange: noop })));
    expect(last(rangeInputProps)).toBeDefined();
    expect(last(rangeInputProps)?.weekStartsOn).toBe(0);
  });

  it("SnoozeDialog has no bundle and starts on Monday until the store has published", async () => {
    await render(createElement(SnoozeDialog, { isOpen: true, openedAt: new Date(2026, 9, 17, 10, 0), onOpenChange: noop, onConfirm: noop }));
    expect(last(dateTimeInputProps)).toBeDefined();
    expect(last(dateTimeInputProps)?.weekStartsOn).toBe(1);
  });
});

describe("week start after the settings store has published", () => {
  it("the store wins in every picker, and a later save reaches an open one", async () => {
    await act(async () => {
      publishWorkspaceSettings({ week_start: 6 });
    });
    await render(inProject(createElement("div", null, createElement(DateControl, { value: "2026-10-20", onChange: noop }))));
    expect(last(dateInputProps)?.weekStartsOn).toBe(6);
    await act(async () => {
      publishWorkspaceSettings({ week_start: 3 });
    });
    expect(last(dateInputProps)?.weekStartsOn).toBe(3);
  });

  it("CycleDialog follows the store", async () => {
    await render(inProject(createElement(CycleDialog, { projectId: bundle.project.id, isOpen: true, onOpenChange: noop })));
    expect(last(rangeInputProps)?.weekStartsOn).toBe(3);
  });

  it("SnoozeDialog follows the store", async () => {
    await render(createElement(SnoozeDialog, { isOpen: true, openedAt: new Date(2026, 9, 17, 10, 0), onOpenChange: noop, onConfirm: noop }));
    expect(last(dateTimeInputProps)?.weekStartsOn).toBe(3);
  });
});

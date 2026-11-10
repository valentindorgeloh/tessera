// @vitest-environment jsdom
/**
 * The export's result survives closing the dialog (speed batch, review round 1): the
 * form body mounts only while the dialog is open, but the Download button belongs to
 * the dialog, so closing during an export, or after one, and reopening still shows it.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const createExportAction = vi.fn();
vi.mock("@/app/actions/exports", () => ({ createExportAction: (...args: unknown[]) => createExportAction(...args) }));

const { ExportDialog } = await import("@/components/exports/ExportDialog");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.show ??= function show(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
  }
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  createExportAction.mockReset();
});

const scope = { project_id: "p", filters: {}, rich_filters: null, order_by: "manual" as const };
const dialog = (isOpen: boolean) => createElement(ExportDialog, { isOpen, onOpenChange: vi.fn(), title: "Website", scope: scope as never });
const buttonNamed = (name: string) => Array.from(document.querySelectorAll<HTMLElement>("button, a")).find((el) => el.getAttribute("aria-label") === name || el.textContent?.trim() === name);

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
}
async function rerender(node: ReactNode) {
  await act(async () => root?.render(node));
}

describe("ExportDialog result", () => {
  it("shows Download after a close and reopen while the export was running", async () => {
    let finish: (value: unknown) => void = () => {};
    createExportAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await render(dialog(true));
    await act(async () => buttonNamed("Export")?.click());
    expect(createExportAction).toHaveBeenCalledTimes(1);
    await rerender(dialog(false));
    await act(async () => finish({ ok: true, data: { id: "exp-1", status: "done", row_count: 3 } }));
    await rerender(dialog(true));
    expect(buttonNamed("Download")?.getAttribute("href")).toBe("/api/exports/exp-1");
  });

  it("keeps Download after a finished export is closed and reopened", async () => {
    createExportAction.mockResolvedValue({ ok: true, data: { id: "exp-2", status: "done", row_count: 1 } });
    await render(dialog(true));
    await act(async () => buttonNamed("Export")?.click());
    await vi.waitFor(() => expect(buttonNamed("Download")).toBeTruthy());
    await rerender(dialog(false));
    await rerender(dialog(true));
    expect(buttonNamed("Download")?.getAttribute("href")).toBe("/api/exports/exp-2");
  });
});

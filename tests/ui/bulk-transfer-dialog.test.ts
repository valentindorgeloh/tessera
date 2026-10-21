// @vitest-environment jsdom
/**
 * BulkTransferDialog (decision 107): the project choices of each mode, the
 * confirm a move sends, the count in the button, the 100-item limit and the
 * success path. A copy may land in any live project, the source included
 * (like the single-item dialog); a move leaves out every project that holds a
 * selected item. The Server Action wrapper is mocked, so no database or Next
 * runtime is involved.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ok = (data: unknown) => ({ ok: true as const, data, cursor: 1 });
const transfer = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("@/app/actions/work-items", () => ({
  bulkTransferWorkItemsAction: transfer.action,
}));

const { BulkTransferDialog, BULK_TRANSFER_LIMIT, transferChoices } = await import("@/components/work-items/BulkTransferDialog");

const WEB = "11111111-1111-7111-8111-111111111111";
const OPS = "22222222-2222-7222-8222-222222222222";
const DOC = "33333333-3333-7333-8333-333333333333";
const projects = [
  { id: WEB, name: "Website", identifier: "WEB" },
  { id: OPS, name: "Ops", identifier: "OPS" },
  { id: DOC, name: "Docs", identifier: "DOC" },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onOpenChange = vi.fn();
const onDone = vi.fn();

async function open(props: { mode: "copy" | "move"; ids?: string[]; sourceProjectIds?: string[]; projects?: typeof projects }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const element = (isOpen: boolean) =>
    createElement(BulkTransferDialog, {
      isOpen,
      onOpenChange,
      mode: props.mode,
      ids: props.ids ?? ["a", "b"],
      sourceProjectIds: props.sourceProjectIds ?? [WEB],
      projects: props.projects ?? projects,
      onDone,
    });
  // Closed first, then open: the way BulkBar mounts it.
  await act(async () => {
    root?.render(element(false));
  });
  await act(async () => {
    root?.render(element(true));
  });
}

function dialog(): HTMLDialogElement {
  const found = [...document.querySelectorAll("dialog")].find((entry) => entry.open);
  expect(found).toBeDefined();
  return found as HTMLDialogElement;
}

function button(name: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find((entry) => entry.textContent?.trim() === name);
  expect(found, `button ${name}`).toBeDefined();
  return found as HTMLButtonElement;
}

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
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
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
  transfer.action.mockReset();
  onOpenChange.mockClear();
  onDone.mockClear();
});

describe("transferChoices", () => {
  it("offers every project for a copy, the source included", () => {
    expect(transferChoices(projects, "copy", [WEB]).map((project) => project.id)).toEqual([WEB, OPS, DOC]);
  });

  it("leaves out every source project for a move", () => {
    expect(transferChoices(projects, "move", [WEB]).map((project) => project.id)).toEqual([OPS, DOC]);
    expect(transferChoices(projects, "move", [WEB, OPS]).map((project) => project.id)).toEqual([DOC]);
  });
});

describe("BulkTransferDialog", () => {
  it("names a copy after the count and starts on the first project, the source", async () => {
    await open({ mode: "copy" });
    expect(dialog().getAttribute("aria-label")).toBe("Copy to project");
    expect(dialog().textContent).toContain("Copy 2 work items to project");
    expect(dialog().textContent).toContain("WEB Website");
    expect(button("Copy 2 work items").disabled).toBe(false);
    expect(dialog().textContent).not.toContain("Old keys stop resolving");
  });

  it("names a move after the count, starts past the source and warns about the keys", async () => {
    await open({ mode: "move", ids: ["a"] });
    expect(dialog().getAttribute("aria-label")).toBe("Move to project");
    expect(dialog().textContent).toContain("Move 1 work item to project");
    expect(dialog().textContent).toContain("OPS Ops");
    expect(dialog().textContent).not.toContain("WEB Website");
    expect(dialog().textContent).toContain("Old keys stop resolving");
    expect(button("Move 1 work item").disabled).toBe(false);
  });

  it("copies into the first project without a confirm, then closes and reports done", async () => {
    transfer.action.mockResolvedValue(ok([{ id: "n1", key: "WEB-41" }, { id: "n2", key: "WEB-42" }]));
    await open({ mode: "copy" });
    await act(async () => {
      button("Copy 2 work items").click();
    });
    expect(transfer.action).toHaveBeenCalledTimes(1);
    expect(transfer.action).toHaveBeenCalledWith({ work_item_ids: ["a", "b"], project_id: WEB, mode: "copy" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("moves with confirm: true into the first project that is not a source", async () => {
    transfer.action.mockResolvedValue(ok([{ id: "a", key: "OPS-1" }, { id: "b", key: "OPS-2" }]));
    await open({ mode: "move" });
    await act(async () => {
      button("Move 2 work items").click();
    });
    expect(transfer.action).toHaveBeenCalledWith({ work_item_ids: ["a", "b"], project_id: OPS, mode: "move", confirm: true });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog and the selection when the call is refused", async () => {
    transfer.action.mockResolvedValue({ ok: false as const, message: "RULE same_project: nope" });
    await open({ mode: "move" });
    await act(async () => {
      button("Move 2 work items").click();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("disables a move when every project holds a selected item", async () => {
    await open({ mode: "move", sourceProjectIds: [WEB, OPS, DOC] });
    expect(button("Move 2 work items").disabled).toBe(true);
    await act(async () => {
      button("Move 2 work items").click();
    });
    expect(transfer.action).not.toHaveBeenCalled();
  });

  it(`refuses more than ${BULK_TRANSFER_LIMIT} work items`, async () => {
    const ids = Array.from({ length: BULK_TRANSFER_LIMIT + 1 }, (_, index) => `id-${index}`);
    await open({ mode: "copy", ids });
    expect(dialog().textContent).toContain(`Select at most ${BULK_TRANSFER_LIMIT} work items`);
    expect(button(`Copy ${ids.length} work items`).disabled).toBe(true);
  });

  it("closes without calling anything on Cancel", async () => {
    await open({ mode: "copy" });
    await act(async () => {
      button("Cancel").click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(transfer.action).not.toHaveBeenCalled();
  });
});

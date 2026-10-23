// @vitest-environment jsdom
/**
 * VersionHistoryDialog (decision 99): a page gets an Activity tab listing
 * history.activity as the route returns it (newest first, actor, what changed,
 * relative time); a work item has no tab and keeps its versions view. The
 * history route and the actors action are mocked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HistoryResponse } from "@/lib/tessera/types";
import { describePageActivity } from "@/components/history/page-activity";

vi.mock("@/app/actions/history", () => ({
  restorePageVersionAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })),
  restoreWorkItemVersionAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })),
  listActorsAction: vi.fn(async () => ({ ok: true as const, data: { items: [{ id: "a1", name: "Valentin" }, { id: "a2", name: "Claude" }] }, cursor: 1 })),
}));

const { VersionHistoryDialog } = await import("@/components/history/VersionHistoryDialog");

const NOW = "2026-10-11T10:00:00.000Z";
const version = { id: "v1", version: 1, name: "Handbook", actor_id: "a1", created_at: NOW, length: 5, description_md: "Hello" };

const pageHistory: HistoryResponse = {
  versions: [version],
  activity: [
    { seq: 9, verb: "locked", field: null, actor_id: "a2", created_at: NOW, comment: null },
    { seq: 8, verb: "updated", field: "name", actor_id: "a1", created_at: NOW, comment: null },
    { seq: 7, verb: "description", field: null, actor_id: "a1", created_at: NOW, comment: null },
    { seq: 6, verb: "created", field: null, actor_id: "gone", created_at: NOW, comment: null },
  ],
  description_version: 1,
  description_md: "Hello",
};
const workItemHistory: HistoryResponse = { versions: [version], description_version: 1, description_md: "Hello" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type EntityOverrides = Partial<{ currentText: string; title: string; readOnly: boolean }>;

async function open(type: "page" | "work_item", history: HistoryResponse, overrides: EntityOverrides = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => history })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(VersionHistoryDialog, {
        isOpen: true,
        onOpenChange: () => {},
        entity: { type, id: "e1", title: "Handbook", descriptionVersion: 1, currentText: "Hello", ...overrides },
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
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
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => {
      current.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("VersionHistoryDialog Activity tab", () => {
  it("lists page activity newest first with actor, change and time", async () => {
    await open("page", pageHistory);
    const tab = document.querySelector<HTMLElement>('[data-tab-value="activity"]');
    expect(tab).not.toBeNull();
    // The versions view is the default.
    expect(document.body.textContent).toContain("Version 1");
    await act(async () => {
      tab?.click();
    });
    const rows = [...document.querySelectorAll('[role="listitem"]')].map((row) => row.textContent ?? "");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Claude locked the page");
    expect(rows[1]).toContain("Valentin renamed the page");
    expect(rows[2]).toContain("Valentin edited the body");
    expect(rows[3]).toContain("Unknown created the page");
    expect(document.body.textContent).not.toContain("Version 1");
  });

  it("has no Activity tab for a work item and keeps the versions view", async () => {
    await open("work_item", workItemHistory);
    expect(document.querySelector("[data-tab-value]")).toBeNull();
    expect(document.body.textContent).toContain("Version 1");
    expect(document.body.textContent).toContain("Restore this version");
  });
});

describe("describePageActivity", () => {
  it("words each page verb and falls back to the raw verb", () => {
    expect(describePageActivity({ verb: "unlocked", field: null })).toBe("unlocked the page");
    expect(describePageActivity({ verb: "updated", field: "labels" })).toBe("changed the labels");
    expect(describePageActivity({ verb: "updated", field: "parent" })).toBe("moved the page");
    expect(describePageActivity({ verb: "updated", field: "sort_key" })).toBe("changed sort key");
    expect(describePageActivity({ verb: "archived", field: null })).toBe("archived the page");
    expect(describePageActivity({ verb: "pinned", field: null })).toBe("pinned");
  });
});

describe("VersionHistoryDialog restore footer", () => {
  const restoreButton = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Restore this version")) ?? null;
  const isDisabled = (button: HTMLButtonElement | null) => button?.disabled === true || button?.getAttribute("aria-disabled") === "true";

  it("pins Restore this version in the footer, outside the scrolling panes", async () => {
    await open("work_item", { ...workItemHistory, description_md: "Newer text" }, { currentText: "Newer text" });
    const button = restoreButton();
    expect(button).not.toBeNull();
    expect(button?.closest(".tessera-history-pane")).toBeNull();
    expect(button?.closest(".tessera-history-split")).toBeNull();
    expect(isDisabled(button)).toBe(false);
    expect(document.body.textContent).not.toContain("This is the current version");
  });

  it("disables it with the reason while the selected version is the current text", async () => {
    await open("work_item", workItemHistory);
    expect(isDisabled(restoreButton())).toBe(true);
    expect(document.body.textContent).toContain("This is the current version.");
  });

  it("needs the name to match as well on a page", async () => {
    const renamed: HistoryResponse = { ...pageHistory, versions: [{ ...version, name: "Old handbook" }] };
    await open("page", renamed);
    expect(isDisabled(restoreButton())).toBe(false);
  });

  it("has no restore control on a read-only entity or on the Activity tab", async () => {
    await open("work_item", { ...workItemHistory, description_md: "Newer text" }, { currentText: "Newer text", readOnly: true });
    expect(restoreButton()).toBeNull();
  });

  it("hides the footer button on a page's Activity tab", async () => {
    await open("page", { ...pageHistory, description_md: "Newer text" }, { currentText: "Newer text" });
    expect(restoreButton()).not.toBeNull();
    await act(async () => {
      document.querySelector<HTMLElement>('[data-tab-value="activity"]')?.click();
    });
    expect(restoreButton()).toBeNull();
  });
});

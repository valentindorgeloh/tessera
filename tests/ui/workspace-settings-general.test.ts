// @vitest-environment jsdom
/**
 * Settings > General (src/components/workspace-settings/WorkspaceSettingsScreen.tsx):
 * the "Week starts on" selector says it governs calendars and date pickers
 * (every picker reads the workspace week start), and shows the saved day.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceSettingsView } from "@/lib/tessera/types";

vi.mock("@/app/actions/workspace-settings", () => ({ updateWorkspaceSettingsAction: vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 })) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(""),
}));

const { WorkspaceSettingsScreen } = await import("@/components/workspace-settings/WorkspaceSettingsScreen");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

describe("General settings", () => {
  it("explains that the week start applies to calendars and date pickers", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(WorkspaceSettingsScreen, { tab: "general", settings: { name: "Tessera", week_start: 0 } as WorkspaceSettingsView }));
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Week starts on");
    expect(text).toContain("Applies to calendars and date pickers.");
    expect(text).not.toContain("Applies to the calendar layout.");
  });
});

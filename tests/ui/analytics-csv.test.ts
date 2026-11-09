// @vitest-environment jsdom
/**
 * Download CSV on the plain analytics tables (docs/drafts/p10-plan.md U2,
 * decision 100): the shared helper (src/components/charts/csv-download.tsx)
 * writes a BOM + CRLF file named analytics-<table>.csv, the heading shows the
 * button only while the table has rows, and the Modules and Cycles tabs
 * download their rows. Nothing leaves the browser.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { csvBlob, csvFileName, downloadCsv, type CsvTable } from "@/components/charts/csv-download";
import type { CyclesAnalytics, ModulesAnalytics, OverviewAnalytics } from "@/components/analytics/types";

// The overview's project token sits in ProjectFrame, whose archive menu imports Server Action wrappers (the assistant's reach the server-only engine entry).
const action = () => vi.fn(async () => ({ ok: true as const, data: {}, cursor: 1 }));
vi.mock("@/app/actions/ai", () => ({ applyProposalsAction: action(), discardProposalsAction: action() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/analytics",
  useSearchParams: () => new URLSearchParams(""),
}));

const { AnalyticsTableHeading } = await import("@/components/analytics/TableHeading");
const { CyclesPanel, ModulesPanel } = await import("@/components/analytics/PlanningPanels");
const { OverviewPanel } = await import("@/components/analytics/OverviewPanel");

const TABLE: CsvTable = {
  fileStem: "analytics-demo",
  header: ["Name", "Open"],
  rows: [
    ["Ada, Lovelace", 3],
    ["=cmd", null],
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let clicked: { download: string; href: string }[] = [];
let blobs: Blob[] = [];

async function mount(node: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

function allCsvButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].filter((el) => el.getAttribute("aria-label")?.startsWith("Download CSV") || el.textContent?.includes("Download CSV"));
}

/** The Download CSV buttons of the plain tables (the charts' ones sit in their "Data table" collapsible). */
function csvButtons(): HTMLButtonElement[] {
  return allCsvButtons().filter((el) => !el.closest(".tessera-analytics-data-table"));
}

/** The bytes of the last downloaded Blob, decoded without dropping the BOM. */
async function lastBytes(): Promise<Uint8Array> {
  const blob = blobs[blobs.length - 1];
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

async function lastText(): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await lastBytes());
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

beforeEach(() => {
  clicked = [];
  blobs = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return "blob:analytics";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
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
  vi.restoreAllMocks();
});

describe("csv helper", () => {
  it("names the file after the stem", () => {
    expect(csvFileName("analytics-cycles")).toBe("analytics-cycles.csv");
  });

  it("writes a UTF-8 BOM, CRLF lines, quoting and the formula guard", async () => {
    blobs.push(csvBlob(TABLE));
    const bytes = await lastBytes();
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csvBlob(TABLE).type).toBe("text/csv;charset=utf-8");
    expect(await lastText()).toBe('\uFEFFName,Open\r\n"Ada, Lovelace",3\r\n\'=cmd,\r\n');
  });

  it("downloadCsv saves one anchor named <stem>.csv and revokes the object URL", async () => {
    downloadCsv(TABLE);
    expect(clicked).toEqual([{ download: "analytics-demo.csv", href: "blob:analytics" }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:analytics");
    expect([...(await lastBytes()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("AnalyticsTableHeading", () => {
  it("shows Download CSV beside the title and downloads the table", async () => {
    const el = await mount(createElement(AnalyticsTableHeading, { title: "Top assignees", csv: TABLE }));
    expect(el.querySelector("h2")?.textContent).toBe("Top assignees");
    const buttons = csvButtons();
    expect(buttons).toHaveLength(1);
    // The accessible name carries the table, the visible text stays "Download CSV".
    expect(buttons[0].getAttribute("aria-label")).toBe("Download CSV: Top assignees");
    expect(buttons[0].textContent).toContain("Download CSV");
    await act(async () => {
      buttons[0].click();
    });
    expect(clicked.map((entry) => entry.download)).toEqual(["analytics-demo.csv"]);
  });

  it("leaves the button out when the table has no rows", async () => {
    await mount(createElement(AnalyticsTableHeading, { title: "Top assignees", csv: { ...TABLE, rows: [] } }));
    expect(csvButtons()).toHaveLength(0);
  });
});

const scope = { project_ids: null, range: "30d" as const, from: "2026-09-21", to: "2026-10-21" };

describe("analytics tables", () => {
  it("Modules downloads analytics-modules.csv with one row per module", async () => {
    const result: ModulesAnalytics = {
      scope,
      computed_seq: 1,
      by_status: { backlog: 0, planned: 1, in_progress: 1, paused: 0, completed: 0, cancelled: 0 },
      rows: [
        { module_id: "m1", project_id: "p1", project_name: "Website", name: "Launch", status: "in_progress", lead_id: null, target_date: "2026-11-01", total: 4, completed: 1, completion: 0.25 },
        { module_id: "m2", project_id: "p1", project_name: "Website", name: "Docs", status: "planned", lead_id: null, target_date: null, total: 0, completed: 0, completion: 0 },
      ],
    };
    await mount(createElement(ModulesPanel, { result, today: "2026-10-21" }));
    const buttons = csvButtons();
    expect(buttons).toHaveLength(1);
    await act(async () => {
      buttons[0].click();
    });
    expect(clicked[0].download).toBe("analytics-modules.csv");
    expect(await lastText()).toBe(
      "\uFEFFModule,Project,Status,Target date,Completed,Total\r\n" + "Launch,Website,In progress,2026-11-01,1,4\r\n" + "Docs,Website,Planned,,0,0\r\n",
    );
    // The chart's own data table keeps its download, which is not the table's.
    const chartButtons = allCsvButtons().filter((el) => el.closest(".tessera-analytics-data-table"));
    expect(chartButtons).toHaveLength(1);
    await act(async () => {
      chartButtons[0].click();
    });
    expect(clicked[1].download).toMatch(/^analytics-.+\.csv$/);
    expect(clicked[1].download).not.toBe("analytics-modules.csv");
  });

  it("Cycles downloads analytics-cycles.csv and offers nothing for an empty range", async () => {
    const empty: CyclesAnalytics = { scope, computed_seq: 1, rows: [], by_status: { current: 0, upcoming: 0, completed: 0, draft: 0 } };
    await mount(createElement(CyclesPanel, { result: empty, today: "2026-10-21" }));
    expect(csvButtons()).toHaveLength(0);
    await act(async () => {
      root?.render(
        createElement(CyclesPanel, {
          result: {
            ...empty,
            by_status: { current: 1, upcoming: 0, completed: 0, draft: 0 },
            rows: [
              {
                cycle_id: "c1",
                project_id: "p1",
                project_name: "Website",
                name: "Sprint 1",
                status: "current",
                start_date: "2026-10-14",
                end_date: "2026-10-28",
                total: 5,
                completed: 2,
                pending: 3,
                completion: 0.4,
                points: { total: 10, completed: 4 },
              },
            ],
          },
          today: "2026-10-21",
        }),
      );
    });
    await act(async () => {
      csvButtons()[0].click();
    });
    expect(clicked[0].download).toBe("analytics-cycles.csv");
    expect(await lastText()).toBe(
      "\uFEFFCycle,Project,Status,Start date,End date,Pending,Completed,Total,Points completed,Points total\r\n" +
        "Sprint 1,Website,Current,2026-10-14,2026-10-28,3,2,5,4,10\r\n",
    );
  });

  it("Overview offers one download for Top assignees and one for Projects", async () => {
    const result = {
      scope,
      computed_seq: 1,
      kpis: { projects: 1, work_items: 3, open: 2, completed: 1, overdue: 0, due_this_week: 0, active_cycles: 0, active_agents: 0 },
      by_state_group: { backlog: 1, started: 1, completed: 1 },
      by_priority: { none: 3 },
      trend: [],
      top_assignees: [{ actor_id: "a1", name: "Valentin", kind: "user", color: "blue", open: 2, completed: 1 }],
      projects: [{ id: "p1", name: "Website", identifier: "WEB", logo: null, total: 3, open: 2, completed: 1 }],
    } as unknown as OverviewAnalytics;
    await mount(createElement(OverviewPanel, { result, projectIds: ["p1"], today: "2026-10-21" }));
    const buttons = csvButtons();
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0].click();
    });
    expect(await lastText()).toBe("\uFEFFAssignee,Open,Completed\r\nValentin,2,1\r\n");
    await act(async () => {
      buttons[1].click();
    });
    expect(clicked.map((entry) => entry.download)).toEqual(["analytics-assignees.csv", "analytics-projects.csv"]);
    expect(await lastText()).toBe("\uFEFFProject,Identifier,Open,Completed,Total\r\nWebsite,WEB,2,1,3\r\n");
  });
});

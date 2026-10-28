// Route lists for the SMALL (3804) and LARGE (3805) data sets of the measure-prod run.
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");

export const SETS = {
  small: {
    port: 3804,
    project: "01a160df-642f-7102-859a-8c50a72e7f1e",
    item: "01a160df-6440-736b-a03e-3ac1380b7a52",
    cycle: "01a160df-6439-75b4-ab0b-dff5f4ebf05b",
    page: "01a160e1-a737-762a-bb97-10c20cc4257f",
  },
  large: {
    port: 3805,
    project: "01a16ad8-6ddd-7752-91fa-653ae8b8a394",
    item: "01a16ad8-6e4b-75e0-a1b9-93396ad2e9a6",
    cycle: "01a16ad8-6e1d-70cd-95b2-f616ed224936",
    page: null,
  },
};

/** [name, path, readySelector] */
export function routesFor(set) {
  const s = SETS[set];
  const P = `/projects/${s.project}`;
  const r = [
    ["home", "/", null],
    ["projects", "/projects", '[role="main"] a[href^="/projects/"][href$="/work-items"]'],
    ["wi-list", `${P}/work-items`, "[data-list-ready]"],
    ["wi-list-state", `${P}/work-items?q=${q({ layout: "list", group_by: "state" })}`, "[data-list-ready]"],
    ["wi-board-state", `${P}/work-items?q=${q({ layout: "board", group_by: "state" })}`, "[data-list-ready]"],
    ["wi-table-state", `${P}/work-items?q=${q({ layout: "table", group_by: "state" })}`, "[data-list-ready]"],
    ["wi-table", `${P}/work-items?q=${q({ layout: "table" })}`, "[data-list-ready]"],
    ["wi-peek", `${P}/work-items?peek=${s.item}`, "[data-list-ready]"],
    ["work-item", `/work-items/${s.item}`, '[role="main"] h1'],
    ["cycles", `${P}/cycles`, null],
    ["cycle", `${P}/cycles/${s.cycle}`, "[data-list-ready]"],
    ["modules", `${P}/modules`, null],
    ["views", `${P}/views`, null],
    ["pages", `${P}/pages`, null],
  ];
  if (s.page) r.push(["page", `${P}/pages/${s.page}`, '[role="main"] h1']);
  r.push(
    ["intake", `${P}/intake`, null],
    ["inbox", "/inbox", null],
    ["yw-summary", "/your-work/summary", null],
    ["yw-assigned", "/your-work/assigned", null],
    ["agents", "/agents", null],
    ["drafts", "/drafts", null],
    ["workspace-views", "/workspace-views", null],
    ["active-cycles", "/active-cycles", null],
    ["analytics", "/analytics/overview", null],
    ["stickies", "/stickies", null],
    ["wiki", "/wiki", null],
    ["settings", "/settings/general", null],
  );
  return r;
}

export function median(xs) {
  const a = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function pct(xs, p) {
  const a = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const idx = Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1);
  return a[Math.max(0, idx)];
}

import { execSync } from "node:child_process";
export function load() {
  return execSync("uptime").toString().trim().replace(/.*load averages?: /, "");
}

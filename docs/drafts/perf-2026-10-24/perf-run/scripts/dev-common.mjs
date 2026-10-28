// MEASURE-DEV shared helpers: route lists for SMALL/LARGE, dev-log parsing, stats, load averages.
import fs from "node:fs";
import { execSync } from "node:child_process";

const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");

export const SETS = {
  small: {
    project: "01a160df-642f-7102-859a-8c50a72e7f1e",
    item: "01a160df-6440-736b-a03e-3ac1380b7a52",
    cycle: "01a160df-6439-75b4-ab0b-dff5f4ebf05b",
    page: "01a160e1-a737-762a-bb97-10c20cc4257f",
  },
  large: {
    project: "01a16ad8-6ddd-7752-91fa-653ae8b8a394",
    item: "01a16ad8-6e4b-75e0-a1b9-93396ad2e9a6",
    cycle: "01a16ad8-6e1d-70cd-95b2-f616ed224936",
    page: null,
  },
};

/** [name, path, readySelector] in the order a user would open them. */
export function routesFor(set) {
  const s = SETS[set];
  const P = `/projects/${s.project}`;
  const r = [
    ["home", "/", null],
    ["projects", "/projects", '[role="main"] a[href$="/work-items"]'],
    ["wi-list", `${P}/work-items`, "[data-list-ready]"],
    ["wi-board", `${P}/work-items?q=${q({ layout: "board" })}`, "[data-list-ready]"],
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
  return a[Math.max(0, Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1))];
}
export function load() {
  return execSync("uptime").toString().trim().replace(/.*load averages?: /, "");
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dev log reading. Lines look like
//   GET /x 200 in 457ms (next.js: 6ms, generate-params: 344ms, application-code: 107ms)
// and may carry a "compile:" part on a first visit.
const ANSI = /\x1b\[[0-9;]*m/g;
export const logSize = (f) => fs.statSync(f).size;
export function logSince(f, pos) {
  const size = logSize(f);
  const len = Math.max(0, size - pos);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(f, "r");
  fs.readSync(fd, buf, 0, len, pos);
  fs.closeSync(fd);
  return buf.toString("utf8").replace(ANSI, "").split("\n").filter((l) => l.trim().length > 0);
}
function toMs(v) {
  const m = /^([\d.]+)\s*(ms|s|µs|us|min)$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "s" ? n * 1000 : m[2] === "min" ? n * 60000 : m[2] === "ms" ? n : n / 1000;
}
/** Parses a request line into { method, url, status, total, parts: {label: ms} } or null. */
export function parseReq(line) {
  const m = /^\s*(GET|POST|HEAD)\s+(\S+)\s+(\d{3})\s+in\s+([\d.]+\s*(?:ms|s|µs|min))(?:\s+\((.*)\))?/.exec(line);
  if (!m) return null;
  const parts = {};
  if (m[5]) for (const p of m[5].split(/,\s*/)) {
    const k = p.split(":");
    if (k.length >= 2) parts[k[0].trim()] = toMs(k.slice(1).join(":"));
  }
  return { method: m[1], url: m[2], status: Number(m[3]), total: toMs(m[4]), parts };
}
export async function waitLogReq(f, pos, pred, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const lines = logSince(f, pos);
    const reqs = lines.map(parseReq).filter(Boolean);
    const hit = reqs.find(pred);
    if (hit) return { hit, lines };
    await sleep(50);
  }
  return { hit: null, lines: logSince(f, pos) };
}

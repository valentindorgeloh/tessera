// FIXER (gantt): one sample of a hard load of the work-item gantt (?q={display:{layout:"gantt"}}) plus opening one
// row's date popover. Built on integ2-sample.mjs's load(): the gantt has no [data-list-ready], so "ready" is the first
// visible .tessera-gantt-row and "hydrated" is when that row carries a React fiber (perf-init.mjs).
// Usage: node fix-gantt-sample.mjs <port> <projectId> [cpuRate|-] -> one JSON line.
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, rateArg] = process.argv.slice(2);
const rate = rateArg && rateArg !== "-" ? Number(rateArg) : null;
const BASE = `http://127.0.0.1:${port}`;
const LIST = `/projects/${project}/work-items`;
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const GANTT = `${LIST}?q=${q({ layout: "gantt" })}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (rate) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(INIT, ".tessera-gantt-row");
await page.goto(BASE + GANTT, { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__perf?.hydrated != null, null, { timeout: 180000, polling: 50 });
await page.waitForTimeout(800);
const p = await page.evaluate(() => ({
  ready: window.__perf.ready,
  hydrated: window.__perf.hydrated,
  fcp: window.__perf.fcp,
  lt: window.__perf.lt.reduce((a, [, d]) => a + d, 0),
  ltMax: Math.max(0, ...window.__perf.lt.map(([, d]) => d)),
  nodes: document.getElementsByTagName("*").length,
  gridcells: document.querySelectorAll('[role="gridcell"]').length,
  rows: document.querySelectorAll(".tessera-gantt-body .tessera-gantt-row").length,
  dateButtons: document.querySelectorAll('.tessera-gantt-body button[aria-label^="Set dates for"]').length,
  dateFields: document.querySelectorAll(".tessera-gantt-dates").length,
  tooltips: document.querySelectorAll('[role="tooltip"]').length,
}));
const out = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v == null ? v : Math.round(v)]));
// Open row 4's date popover: click to both date fields visible.
await page.waitForLoadState("networkidle").catch(() => null);
await page.waitForTimeout(1000);
const t1 = await page.evaluate(() => performance.now());
const w = Date.now();
await page.locator('.tessera-gantt-body button[aria-label^="Set dates for"]').nth(3).click();
await page.waitForFunction(() => {
  const box = [...document.querySelectorAll(".tessera-gantt-dates")].find((el) => el.checkVisibility());
  return !!box && box.querySelectorAll("input").length >= 2;
}, null, { timeout: 120000, polling: 16 });
out.datesOpenMs = Date.now() - w;
await page.waitForTimeout(500);
out.datesOpenLt = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
await page.keyboard.press("Escape");
await page.waitForFunction(() => ![...document.querySelectorAll(".tessera-gantt-dates")].some((el) => el.checkVisibility()), null, { timeout: 30000, polling: 16 });
out.errors = errors.length;
await ctx.close();
await browser.close();
console.log(JSON.stringify(out));

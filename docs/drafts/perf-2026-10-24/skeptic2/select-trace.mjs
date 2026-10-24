// Skeptic probe: split the first row-checkbox select (and the deselect) on the list into script vs style/layout time.
// Usage: node select-trace.mjs <port> <projectId> <out.json>
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [port, project, out] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/projects/${project}/work-items`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForSelector("[data-list-ready]", { timeout: 120000 });
await page.waitForTimeout(3000);
const row = (i) => page.locator(".tessera-wi-row").nth(i);
const results = {};
for (const [name, sel] of [["select", ".tessera-wi-list--selecting"], ["deselect", ".tessera-wi-list:not(.tessera-wi-list--selecting)"], ["select-again", ".tessera-wi-list--selecting"], ["select-second", null]]) {
  const file = out.replace(/\.json$/, `-${name}.trace.json`);
  await browser.startTracing(page, { path: file, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] });
  const t0 = Date.now();
  await row(name === "select-second" ? 4 : 3).locator(".tessera-wi-select").first().click({ force: true });
  if (sel) await page.waitForSelector(sel, { timeout: 30000 });
  const dt = Date.now() - t0;
  await page.waitForTimeout(1500);
  await browser.stopTracing();
  const trace = JSON.parse(fs.readFileSync(file, "utf8"));
  const events = trace.traceEvents ?? trace;
  // main renderer thread: the one with the most RunTask time
  const byTid = new Map();
  for (const e of events) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
  const main = [...byTid.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sums = {};
  for (const e of events) {
    if (e.ph !== "X" || `${e.pid}:${e.tid}` !== main) continue;
    if (["FunctionCall", "EventDispatch", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "V8.Execute"].includes(e.name) || ["UpdateLayoutTree", "Layout", "RecalculateStyles", "Paint", "PrePaint", "Layerize", "UpdateLayer", "HitTest", "RunTask", "ParseHTML", "Commit"].includes(e.name)) {
      sums[e.name] = (sums[e.name] ?? 0) + e.dur / 1000;
    }
  }
  for (const k of Object.keys(sums)) sums[k] = Math.round(sums[k]);
  results[name] = { dt, ms: sums };
  console.log(name, JSON.stringify(results[name]));
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));
await browser.close();

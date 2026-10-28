// MEASURE-CODE: latency of an inline edit in the work-items list (own write): open a row's priority selector, pick
// another priority, time until the row shows it, and the long-task time until the list settles (optimistic render +
// refresh() re-render). Mutates the DB it runs against: scratch copies only.
// Usage: node code-inline-edit.mjs <port> <projectId> [cpuRate] [row] -> one JSON line.
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, rateArg, rowArg] = process.argv.slice(2);
const rate = rateArg && rateArg !== "-" ? Number(rateArg) : null;
const row = Number(rowArg ?? 4);
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT, "[data-list-ready]");
const cdp = await ctx.newCDPSession(page);
const reqs = [];
page.on("request", (r) => {
  const h = r.headers();
  if (h["next-action"]) reqs.push({ t: Date.now(), kind: "action" });
  else if (h["rsc"] === "1") reqs.push({ t: Date.now(), kind: "rsc" });
  else if (r.url().includes("/api/changes")) reqs.push({ t: Date.now(), kind: "changes" });
});
await page.goto(`${BASE}/projects/${project}/work-items`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForSelector("[data-list-ready]", { timeout: 120000 });
await page.waitForTimeout(2500);
if (rate) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
// The priority selector is the row's second combobox (state, priority, cycle; icon-only, named by aria-labelledby).
const trigger = page.locator("[data-list-ready] .tessera-wi-props").nth(row).locator('[role="combobox"]').nth(1);
await trigger.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const before = await trigger.evaluate((el) => el.outerHTML.length + "|" + (el.querySelector("[aria-label]")?.getAttribute("aria-label") ?? el.textContent));
const t0 = await page.evaluate(() => performance.now());
const w0 = Date.now();
await trigger.click();
await page.waitForSelector('[popover]:popover-open [role="option"]', { timeout: 30000 });
const openMs = Date.now() - w0;
const options = page.locator('[popover]:popover-open [role="option"]');
const n = await options.count();
let pick = null;
for (let i = 0; i < n; i++) {
  const sel = await options.nth(i).getAttribute("aria-selected");
  if (sel !== "true") { pick = i; break; }
}
const t1 = await page.evaluate(() => performance.now());
const w1 = Date.now();
await options.nth(pick).click();
await page.waitForFunction(
  ([idx, prev]) => {
    const el = document.querySelectorAll("[data-list-ready] .tessera-wi-props")[idx]?.querySelectorAll('[role="combobox"]')[1];
    if (!el) return false;
    const now = el.outerHTML.length + "|" + (el.querySelector("[aria-label]")?.getAttribute("aria-label") ?? el.textContent);
    return now !== prev;
  },
  [row, before],
  { timeout: 30000, polling: "raf" },
);
const commitMs = Date.now() - w1;
// Settle: wait until 1 s passes with no new long task (max 20 s).
const settle = await page.evaluate(async (t1) => {
  const start = performance.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    const last = window.__perf.lt.filter(([s]) => s >= t1).map(([s, d]) => s + d);
    const lastEnd = last.length ? Math.max(...last) : t1;
    if (performance.now() - lastEnd > 1000 || performance.now() - start > 20000) {
      return { settleMs: Math.round(lastEnd - t1), ltAfterPick: window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), ltOpen: window.__perf.lt.filter(([s]) => s >= window.__t0 && s < t1).reduce((a, [, d]) => a + d, 0) };
    }
  }
}, t1);
// Fixed 6 s window after the pick: the ChangesPoller (4 s interval) sees the user's own write and may refresh again.
await page.waitForTimeout(Math.max(0, 6000 - (Date.now() - w1)));
const win = reqs.filter((r) => r.t >= w1).map((r) => `${r.kind}@${r.t - w1}`);
const lt6s = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
const ltOpen = await page.evaluate(([a, b]) => window.__perf.lt.filter(([s]) => s >= a && s < b).reduce((x, [, d]) => x + d, 0), [t0, t1]);
console.log(JSON.stringify({ rate: rate ?? 1, row, openMs, ltOpen, commitMs, settleMs: settle.settleMs, ltAfterPick: settle.ltAfterPick, lt6s, requests6s: win }));
await browser.close();

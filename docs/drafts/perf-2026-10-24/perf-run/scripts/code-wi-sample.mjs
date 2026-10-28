// MEASURE-CODE: one sample of (a) a full load of the work-items list and (b) a sidebar navigation /inbox -> list.
// Usage: node code-wi-sample.mjs <port> <projectId> [cpuRate] -> prints one JSON line.
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, rate] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
const LIST = `/projects/${project}/work-items`;
const browser = await chromium.launch();
async function ctxPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (rate) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(rate) });
  return { ctx, page };
}
const out = {};
{
  const { ctx, page } = await ctxPage();
  await page.addInitScript(INIT, "[data-list-ready]");
  await page.goto(BASE + LIST, { waitUntil: "commit", timeout: 120000 });
  await page.waitForFunction(() => window.__perf?.hydrated !== null && window.__perf?.hydrated !== undefined, null, { timeout: 120000, polling: 50 });
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => ({ ready: window.__perf.ready, hydrated: window.__perf.hydrated, fcp: window.__perf.fcp, lcp: window.__perf.lcp, lt: window.__perf.lt.reduce((a, [, d]) => a + d, 0), ltMax: Math.max(0, ...window.__perf.lt.map(([, d]) => d)), nodes: document.getElementsByTagName("*").length }));
  out.load = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v == null ? v : Math.round(v)]));
  await ctx.close();
}
{
  const { ctx, page } = await ctxPage();
  await page.addInitScript(INIT, null);
  await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);
  const before = page.url();
  const t0 = Date.now();
  await page.locator(`a[href="${LIST}"]`).first().click();
  while (page.url() === before && Date.now() - t0 < 60000) await page.waitForTimeout(5);
  const urlMs = Date.now() - t0;
  await page.waitForFunction(() => !!window.__perfReadyEl?.("[data-list-ready]"), null, { timeout: 60000, polling: 16 });
  out.nav = { urlMs, readyMs: Date.now() - t0 };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out));

// MEASURE-CODE: one sample of full loads of the list and table layouts plus a sidebar navigation /inbox -> list.
// Usage: node code-wi-sample2.mjs <port> <projectId> [cpuRate|-] -> one JSON line.
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, rateArg] = process.argv.slice(2);
const rate = rateArg && rateArg !== "-" ? Number(rateArg) : null;
const BASE = `http://127.0.0.1:${port}`;
const LIST = `/projects/${project}/work-items`;
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const TABLE = `${LIST}?q=${q({ layout: "table" })}`;
const browser = await chromium.launch();
async function ctxPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (rate) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return { ctx, page };
}
async function load(path, withPeek = false) {
  const { ctx, page } = await ctxPage();
  await page.addInitScript(INIT, "[data-list-ready]");
  await page.goto(BASE + path, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__perf?.hydrated != null, null, { timeout: 180000, polling: 50 });
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => ({ ready: window.__perf.ready, hydrated: window.__perf.hydrated, fcp: window.__perf.fcp, lt: window.__perf.lt.reduce((a, [, d]) => a + d, 0), ltMax: Math.max(0, ...window.__perf.lt.map(([, d]) => d)), nodes: document.getElementsByTagName("*").length }));
  const res = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v == null ? v : Math.round(v)]));
  if (withPeek) {
    // Open a row in the peek (router.push of ?peek=): click to the panel showing the item title.
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(1000);
    const t1 = await page.evaluate(() => performance.now());
    const w = Date.now();
    await page.locator("[data-list-ready] button.tessera-wi-open").nth(3).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".tessera-peek-panel");
      return !!panel && panel.checkVisibility() && !!panel.querySelector('h1, h2, [contenteditable="true"]');
    }, null, { timeout: 120000, polling: 16 });
    res.peekMs = Date.now() - w;
    await page.waitForTimeout(1000);
    res.peekLt = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
  }
  await ctx.close();
  return res;
}
const out = {};
out.list = await load(LIST, true);
out.table = await load(TABLE);
{
  const { ctx, page } = await ctxPage();
  await page.addInitScript(INIT, null);
  await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1500);
  const before = page.url();
  const t0 = Date.now();
  await page.locator(`a[href="${LIST}"]`).first().click();
  while (page.url() === before && Date.now() - t0 < 120000) await page.waitForTimeout(5);
  const urlMs = Date.now() - t0;
  await page.waitForFunction(() => !!window.__perfReadyEl?.("[data-list-ready]"), null, { timeout: 120000, polling: 16 });
  out.nav = { urlMs, readyMs: Date.now() - t0 };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out));

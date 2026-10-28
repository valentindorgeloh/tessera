// In-build A/B of the scroller rule on the UNGROUPED 10k list: /inbox -> list click, with the two `.tessera-wi-scroller--grouped`
// rules either left alone (class) or retargeted through the CSSOM to `.tessera-wi-scroller:has(.tessera-wi-group)` (has) before the click.
// Usage: node has-nav.mjs <port> <projectId> <mode> [layout]
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, mode, layout = "list"] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
const q = Buffer.from(JSON.stringify({ display: { layout } })).toString("base64url");
const LIST = `/projects/${project}/work-items`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(INIT, null);
await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(1500);
const swapped = await page.evaluate((mode) => {
  if (mode !== "has") return 0;
  let n = 0;
  const walk = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText === ".tessera-wi-scroller--grouped") { r.selectorText = ".tessera-wi-scroller:has(.tessera-wi-group)"; n++; } } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  return n;
}, mode);
// Set the layout through the URL by pushing the history entry the sidebar link would load: use the link, then the layout param is applied by a client navigation.
const t1 = await page.evaluate(() => performance.now());
const before = page.url();
const t0 = Date.now();
await page.locator(`a[href="${LIST}"]`).first().click();
while (page.url() === before && Date.now() - t0 < 120000) await page.waitForTimeout(5);
await page.waitForFunction(() => !!window.__perfReadyEl?.("[data-list-ready]"), null, { timeout: 120000, polling: 16 });
const readyMs = Date.now() - t0;
await page.waitForTimeout(800);
const lt = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
const ltMax = await page.evaluate((t1) => Math.max(0, ...window.__perf.lt.filter(([s]) => s >= t1).map(([, d]) => d)), t1);
const rows = await page.evaluate(() => document.querySelectorAll(".tessera-wi-row").length);
console.log(JSON.stringify({ mode, swapped, readyMs, lt, ltMax, rows }));
await browser.close();

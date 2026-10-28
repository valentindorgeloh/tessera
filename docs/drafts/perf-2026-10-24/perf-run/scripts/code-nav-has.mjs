// MEASURE-CODE: does Tessera's `:has()` CSS amplify the list's forced layouts? Sidebar navigation /inbox -> list with
// the `:has(` rules deleted through CSSOM before the click ("nohas") or left alone ("has").
// Usage: node code-nav-has.mjs <port> <projectId> <has|nohas> [cpuRate|-] -> one JSON line.
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project, mode, rateArg] = process.argv.slice(2);
const rate = rateArg && rateArg !== "-" ? Number(rateArg) : null;
const BASE = `http://127.0.0.1:${port}`;
const LIST = `/projects/${project}/work-items`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT, null);
const cdp = await ctx.newCDPSession(page);
if (rate) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(1500);
let removed = 0;
if (mode === "nohas") {
  removed = await page.evaluate(() => {
    let n = 0;
    const walk = (list, owner) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules, r);
        else if (r.selectorText && r.selectorText.includes(":has(")) { owner.deleteRule(i); n++; }
      }
    };
    for (const s of document.styleSheets) { try { walk(s.cssRules, s); } catch {} }
    return n;
  });
}
const t1 = await page.evaluate(() => performance.now());
const before = page.url();
const t0 = Date.now();
await page.locator(`a[href="${LIST}"]`).first().click();
while (page.url() === before && Date.now() - t0 < 120000) await page.waitForTimeout(5);
await page.waitForFunction(() => !!window.__perfReadyEl?.("[data-list-ready]"), null, { timeout: 120000, polling: 16 });
const readyMs = Date.now() - t0;
await page.waitForTimeout(800);
const lt = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
console.log(JSON.stringify({ mode, removed, readyMs, lt }));
await browser.close();

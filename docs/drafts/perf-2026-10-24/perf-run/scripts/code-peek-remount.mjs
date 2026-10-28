// MEASURE-CODE: does opening the peek (?peek= push) remount the list or only re-render it? Marks the list's DOM before
// the click and checks after. Also records whether the list skeleton flashed and the RSC bytes of the push.
// Usage: node code-peek-remount.mjs <port> <projectId>
import { chromium } from "@playwright/test";
const [port, project] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const rsc = [];
page.on("response", async (r) => {
  if (r.request().headers()["rsc"] === "1" || /_rsc=/.test(r.url())) {
    try { rsc.push({ url: r.url().replace(BASE, "").slice(0, 90), kb: Math.round((await r.body()).length / 1024) }); } catch {}
  }
});
await page.goto(`${BASE}/projects/${project}/work-items`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForSelector("[data-list-ready]");
await page.waitForTimeout(1500);
rsc.length = 0;
await page.evaluate(() => {
  window.__marked = { list: document.querySelector("[data-list-ready]"), row: document.querySelector("[data-list-ready] button.tessera-wi-open"), chip: document.querySelector("[data-list-ready] button.tessera-wi-chip"), skeleton: false };
  new MutationObserver(() => { if (document.querySelector('[role="main"] .astryx-skeleton')) window.__marked.skeleton = true; }).observe(document.body, { subtree: true, childList: true });
});
const w = Date.now();
await page.locator("[data-list-ready] button.tessera-wi-open").nth(3).click();
await page.waitForFunction(() => { const p = document.querySelector(".tessera-peek-panel"); return !!p && p.checkVisibility() && !!p.querySelector('h1, h2, [contenteditable="true"]'); }, null, { timeout: 120000 });
const peekMs = Date.now() - w;
await page.waitForTimeout(1500);
const r = await page.evaluate(() => ({ listSame: window.__marked.list?.isConnected === true, rowSame: window.__marked.row?.isConnected === true, chipSame: window.__marked.chip?.isConnected === true, skeletonFlashed: window.__marked.skeleton }));
console.log(JSON.stringify({ peekMs, ...r, rsc }));
await browser.close();

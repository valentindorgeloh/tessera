// Probe (perf-research/next): cost of opening the side peek from the work items list on a production build.
// Opening a peek is router.push("?peek=<id>"), so the page segment re-renders on the server: this records the
// RSC request (size, time) and click-to-visible for the peek title, then the same for closing it.
// Usage: node peek-probe.mjs <port> <projectId> <outFile>. Indicative only.
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(new URL("./tree/package.json", import.meta.url));
const { chromium } = require("playwright");
const [port, project, outFile] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(" ");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
const reqs = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (!("rsc" in h)) return;
  reqs.set(e.requestId, { url: e.request.url.replace(base, ""), prefetch: h["next-router-prefetch"] ?? null, ts: e.timestamp, kb: null, ms: null, t: Date.now() });
});
cdp.on("Network.loadingFinished", (e) => {
  const r = reqs.get(e.requestId);
  if (r) {
    r.kb = +(e.encodedDataLength / 1024).toFixed(1);
    r.ms = Math.round((e.timestamp - r.ts) * 1000);
  }
});
cdp.on("Network.dataReceived", (e) => {
  const r = reqs.get(e.requestId);
  if (r) r.decodedKb = +(((r.decodedKb ?? 0) * 1024 + e.dataLength) / 1024).toFixed(1);
});

await page.goto(`${base}/projects/${project}/work-items`, { waitUntil: "load" });
await page.waitForSelector("[data-list-ready]");
await page.waitForTimeout(4000);
await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask" }); });
const out = { load_before: load(), runs: [] };

for (let i = 0; i < 3; i++) {
  const rowTitle = page.locator("[data-list-ready] li.tessera-wi-row").filter({ visible: true }).nth(i + 2).locator("span").first();
  await page.evaluate(() => (window.__lt.length = 0));
  const t0 = Date.now();
  const before = Date.now();
  await rowTitle.click();
  // Ready: the URL names the peek and the detail's description editor is visible (the detail has rendered).
  await page.waitForFunction(() => location.search.includes("peek=") && [...document.querySelectorAll('[contenteditable="true"]')].some((e) => e.checkVisibility()), null, { timeout: 30000, polling: 50 }).catch(() => null);
  const openMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const navReqs = [...reqs.values()].filter((r) => r.t >= before - 5 && !r.prefetch && r.url.includes("peek="));
  const longTasks = await page.evaluate(() => window.__lt.slice());
  const listRowsAfter = await page.evaluate(() => document.querySelectorAll("li.tessera-wi-row").length);
  out.runs.push({ open_wall_ms: openMs, long_tasks_ms: longTasks, list_rows_after: listRowsAfter, rsc: navReqs.map(({ ts, t, ...rest }) => rest) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
}
out.load_after = load();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();

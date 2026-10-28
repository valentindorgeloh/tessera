// MEASURE-CODE: CPU profile of one client navigation (sidebar click) and where the time goes, by script URL and function.
// Usage: node code-nav-profile.mjs <port> <fromPath> <linkSelector> <readySelector|-> <out.json> [cpuRate]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { INIT } from "./perf-init.mjs";

const [port, from, link, readySel, out, rateArg] = process.argv.slice(2);
const sel = readySel === "-" ? null : readySel;
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT, null);
const cdp = await ctx.newCDPSession(page);
if (rateArg) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(rateArg) });
await page.goto(BASE + from, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(2500);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const before = page.url();
const t0 = Date.now();
await page.locator(link).first().click();
while (page.url() === before && Date.now() - t0 < 60000) await page.waitForTimeout(10);
const urlMs = Date.now() - t0;
await page.waitForFunction((s) => !!window.__perfReadyEl?.(s), sel, { timeout: 60000 });
const readyMs = Date.now() - t0;
await page.waitForTimeout(300);
const { profile } = await cdp.send("Profiler.stop");
// Self time per node -> aggregate by function+url and by url.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
const byFn = {};
const byUrl = {};
for (const [id, us] of self) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const url = (cf.url || "(native)").replace(BASE, "").replace(/\?.*$/, "");
  const shortUrl = url.split("/").pop().slice(0, 70);
  const fn = `${cf.functionName || "(anon)"} @ ${shortUrl}:${cf.lineNumber}`;
  byFn[fn] = (byFn[fn] ?? 0) + us / 1000;
  byUrl[shortUrl] = (byUrl[shortUrl] ?? 0) + us / 1000;
}
const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, ms]) => [n, Math.round(ms)]);
const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
const res = { from, link, cpuRate: rateArg ? Number(rateArg) : 1, urlMs, readyMs, profiledMs: Math.round(total), byUrl: top(byUrl, 15), byFn: top(byFn, 30) };
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(out, JSON.stringify(res, null, 2));
await browser.close();

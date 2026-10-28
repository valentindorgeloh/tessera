// MEASURE-CODE: CPU profile of one full page load until the ready selector shows; self time by function and script.
// Usage: node code-load-profile.mjs <port> <path> <readySelector> <out.json> [cpuRate]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { INIT } from "./perf-init.mjs";
const [port, path, sel, out, rateArg] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT, sel);
const cdp = await ctx.newCDPSession(page);
if (rateArg) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(rateArg) });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
const t0 = Date.now();
await page.goto(BASE + path, { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__perf?.hydrated != null, null, { timeout: 180000, polling: 50 });
const readyMs = Date.now() - t0;
await page.waitForTimeout(500);
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
const byFn = {};
for (const [id, us] of self) {
  const cf = byId.get(id).callFrame;
  const url = (cf.url || "(native)").replace(BASE, "").replace(/\?.*$/, "").split("/").pop().slice(0, 60);
  const fn = `${cf.functionName || "(anon)"} @ ${url}:${cf.lineNumber}`;
  byFn[fn] = (byFn[fn] ?? 0) + us / 1000;
}
const top = Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, ms]) => [n, Math.round(ms)]);
const lt = await page.evaluate(() => window.__perf.lt.reduce((a, [, d]) => a + d, 0));
const res = { path, readyMs, lt, nodes: await page.evaluate(() => document.getElementsByTagName("*").length), byFn: top };
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(out, JSON.stringify(res, null, 2));
await browser.close();

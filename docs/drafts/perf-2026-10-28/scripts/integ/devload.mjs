// Component-name histograms (dev build) for load and interactions on the small project. Usage: node devcount.mjs <port> <projectId> <tag> [cpu]
import fs from "node:fs";
import { newPage, gotoReady, load, q, cpuProbe } from "./lib.mjs";
const port = process.argv[2] ?? "3845";
const PID = process.argv[3] ?? "01a160df-642f-7102-859a-8c50a72e7f1e";
const tag = process.argv[4] ?? "dev";
const cpu = Number(process.argv[5] ?? 1);
const base = `http://127.0.0.1:${port}`;
const { browser, page } = await newPage({ cpu, fromStart: true });
const cp = await cpuProbe(browser);
const out = { tag, port, cpu, scenarios: {} };
const settle = (quiet = 800) => page.evaluate((qt) => window.__settle(qt, 120000), quiet);

console.log("load", load());
const t0 = Date.now();
const c0 = await cp.read();
await page.goto(`${base}/projects/${PID}/work-items`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-list-ready]", { state: "attached", timeout: 240000 });
await settle(1500);
const c1 = await cp.read();
let r = await page.evaluate(() => {
  const S = window.__rc;
  return { commits: S.commits, worked: S.worked, nodes: document.getElementsByTagName("*").length, rows: document.querySelectorAll(".tessera-wi-row").length, hist: [...S.byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40), log: S.log.slice(0, 50), lt: window.__lt.map(([s, d]) => [Math.round(s), Math.round(d)]) };
});
out.scenarios.load = { ...r, wallMs: Date.now() - t0, cpuMs: Math.round(c1 - c0) };
console.log("LOAD", JSON.stringify({ commits: r.commits, worked: r.worked, nodes: r.nodes, rows: r.rows, wallMs: Date.now() - t0, cpuMs: Math.round(c1 - c0), lt: r.lt }));
console.log("LOAD commit log", JSON.stringify(r.log));
console.log("LOAD hist", JSON.stringify(r.hist.slice(0, 30)));

await browser.close();

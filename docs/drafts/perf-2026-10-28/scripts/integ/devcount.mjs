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

async function measure(name, act, spec) {
  await page.evaluate((s) => window.__arm(s), spec);
  const a = await cp.read();
  await act();
  await page.waitForFunction(() => window.__armed && window.__armed.ready !== null, null, { timeout: 120000 }).catch(() => {});
  const b = await cp.read();
  await settle();
  const c = await cp.read();
  const res = await page.evaluate(() => window.__collect());
  const o = { ...res, cpuToReadyMs: Math.round(b - a), cpuTotalMs: Math.round(c - a), load: load() };
  (out.scenarios[name] ??= []).push(o);
  console.log(name.toUpperCase(), JSON.stringify({ dt: o.dt, cpuReady: o.cpuToReadyMs, cpuTotal: o.cpuTotalMs, commits: o.commits, worked: o.worked, lt: o.longTasks }));
  console.log(name.toUpperCase(), "hist", JSON.stringify(o.topTypes));
}
const row = (n) => page.locator(".tessera-wi-row").nth(n);
for (let i = 0; i < 2; i++) {
  await measure("select", () => row(3).locator(".tessera-wi-select").first().click({ force: true }), { sel: ".tessera-wi-list--selecting" });
  await settle();
  await measure("deselect", () => row(3).locator(".tessera-wi-select").first().click({ force: true }), { sel: ".tessera-wi-list:not(.tessera-wi-list--selecting)" });
  await settle();
  await measure("peek-open", () => row(5).locator(".tessera-wi-open").click(), { sel: ".tessera-peek-panel .astryx-heading" });
  await settle(1500);
  await measure("peek-close", () => page.keyboard.press("Escape"), { sel: "[data-list-ready]", gone: ".tessera-peek-panel" });
  await settle(1500);
  await measure("state-pick", async () => {
    await row(7).locator("[role=combobox]").first().click();
    await page.locator("[role=listbox]:visible [role=option]").first().waitFor({ state: "visible" });
    await page.evaluate(() => window.__arm({ sel: ".tessera-wi-row" }));
    await page.locator("[role=listbox]:visible [role=option]").nth(i % 2 === 0 ? 1 : 4).click();
  }, { sel: ".tessera-wi-row" });
  await settle(2500);
}
fs.writeFileSync(new URL(`./out-${tag}.json`, import.meta.url).pathname, JSON.stringify(out, null, 1));
await browser.close();

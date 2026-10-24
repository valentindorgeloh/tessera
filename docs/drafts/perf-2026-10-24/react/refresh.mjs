// Refresh, hidden-route and navigation scenarios on the 10k list (prod, 3841). Usage: node refresh.mjs <cpuRate> <runs> <tag>
import fs from "node:fs";
import { execSync } from "node:child_process";
import { newPage, gotoReady, load, q, cpuProbe } from "./lib.mjs";
const cpu = Number(process.argv[2] ?? 1);
const runs = Number(process.argv[3] ?? 2);
const tag = process.argv[4] ?? `refresh-cpu${cpu}`;
const base = "http://127.0.0.1:3841";
const PID = "01a16ad8-6ddd-7752-91fa-653ae8b8a394";
const P = `/projects/${PID}`;
const DB = new URL("./data/react-large.db", import.meta.url).pathname;
const PROD = new URL("./prod", import.meta.url).pathname;
const ITEM = "01a16ad8-6e4e-7608-a668-b8fe28aba5f1"; // PERF-2
const { browser, page } = await newPage({ cpu });
const cp = await cpuProbe(browser);
const results = {};
const settle = (quiet = 600) => page.evaluate((qt) => window.__settle(qt, 90000), quiet);

function externalWrite(name) {
  execSync(`npx tsx scripts/mcp-call.ts --client react-probe update_work_item '${JSON.stringify({ work_item_id: ITEM, name })}'`, {
    cwd: PROD,
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}`, TESSERA_DB_PATH: DB },
    stdio: "ignore",
  });
}

async function record(name, extra = {}) {
  const c2 = await cp.read();
  const r = await page.evaluate(() => window.__collect());
  const out = { ...r, ...extra, load: load() };
  (results[name] ??= []).push(out);
  console.log(name, JSON.stringify({ dt: out.dt, cpuReady: out.cpuToReadyMs, cpuTotal: out.cpuTotalMs, commits: out.commits, worked: out.worked, lt: out.longTasks, top: out.topTypes.slice(0, 3).map((t) => t.join("=")).join(" ") }));
}

async function measure(name, act, spec, { manual = false } = {}) {
  await page.evaluate((s) => window.__arm(s), spec);
  const c0 = await cp.read();
  await act();
  if (manual) await page.evaluate(() => window.__markT0());
  await page.waitForFunction(() => window.__armed && window.__armed.ready !== null, null, { timeout: 90000 }).catch(() => {});
  const c1 = await cp.read();
  await settle(manual ? 1500 : 600);
  const c2 = await cp.read();
  const r = await page.evaluate(() => window.__collect());
  const out = { ...r, cpuToReadyMs: Math.round(c1 - c0), cpuTotalMs: Math.round(c2 - c0), load: load() };
  (results[name] ??= []).push(out);
  console.log(name, JSON.stringify({ dt: out.dt, cpuReady: out.cpuToReadyMs, cpuTotal: out.cpuTotalMs, commits: out.commits, worked: out.worked, lt: out.longTasks, top: out.topTypes.slice(0, 3).map((t) => t.join("=")).join(" ") }));
}

console.log("cpu", cpu, "load", load());
await gotoReady(page, `${base}${P}/work-items`);
console.log("loaded; nodes", await page.evaluate(() => document.getElementsByTagName("*").length));

for (let i = 0; i < runs; i++) {
  const mark = `r${cpu}x${i}${Date.now() % 1000}`;
  // A. external write while the list is visible
  await measure("external-write-list-visible", () => externalWrite(`Investigate importer in the nightly build ${mark}`), { sel: ".tessera-wi-row", text: mark }, { manual: true });
  await settle(1000);

  // B. navigate away (list goes hidden under Activity)
  await measure("nav-away-to-inbox", () => page.locator('nav[aria-label=Work] a[href="/inbox"]').click(), { sel: "[role=main]", text: "Inbox", gone: "[data-list-ready]" });
  await settle(1500);
  const hiddenInfo = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, listVisible: !![...document.querySelectorAll("[data-list-ready]")].find((e) => e.checkVisibility()), lists: document.querySelectorAll("[data-list-ready]").length }));
  console.log("after nav-away", JSON.stringify(hiddenInfo));

  // C. external write while the list is hidden
  const mark2 = `${mark}h`;
  await measure("external-write-list-hidden", () => externalWrite(`Investigate importer in the nightly build ${mark2}`), { sel: "[role=main]", text: "Inbox" }, { manual: true });
  await settle(1000);

  // D. navigate back to the list (project link in the sidebar)
  await measure("nav-back-to-list", () => page.locator(`nav[aria-label=Work] a[href="${P}/work-items"]`).click(), { sel: "[data-list-ready]", text: "PERF-" });
  await settle(2000);
  const back = await page.evaluate((m) => ({ stale: !document.body.textContent.includes(m), nodes: document.getElementsByTagName("*").length }), mark2);
  console.log("after nav-back", JSON.stringify(back));

  // E. scroll the list for 2 s: frame intervals
  const frames = await page.evaluate(async () => {
    const sc = document.querySelector(".tessera-wi-scroller");
    const out = [];
    let last = performance.now();
    const end = last + 2500;
    await new Promise((resolve) => {
      const tick = (t) => {
        out.push(t - last);
        last = t;
        sc.scrollTop += 120;
        if (t < end) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    sc.scrollTop = 0;
    return out;
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const sc = { n: frames.length, p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), max: Math.round(sorted[sorted.length - 1]) };
  (results["scroll-200-rows"] ??= []).push(sc);
  console.log("scroll-200-rows", JSON.stringify(sc), "load", load());
  await settle(800);
}
fs.writeFileSync(new URL(`./out-${tag}.json`, import.meta.url).pathname, JSON.stringify({ cpu, runs, startedAt: new Date().toISOString(), results }, null, 1));
await browser.close();

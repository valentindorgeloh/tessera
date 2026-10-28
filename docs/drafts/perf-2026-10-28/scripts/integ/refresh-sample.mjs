// Refresh, hidden-route and navigation scenarios on the 10k list (prod, 3841). Usage: node refresh.mjs <cpuRate> <runs> <tag>
import fs from "node:fs";
import { execSync } from "node:child_process";
import { newPage, gotoReady, load, q, cpuProbe } from "./lib.mjs";
const [port, PID, PROD, DB] = process.argv.slice(2);
const cpu = 1;
const runs = 1;
const base = `http://127.0.0.1:${port}`;
const P = `/projects/${PID}`;
const ITEM = process.env.ITEM ?? "01a16ad8-6e4e-7608-a668-b8fe28aba5f1"; // PERF-2
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
}

await gotoReady(page, `${base}${P}/work-items`);

{
  // The first write after a load also carries the one-off commits that follow hydration (the week-start store's first publish); it is recorded apart, the steady state is the next one.
  const m = `w${Date.now() % 100000}`;
  await measure("first-write", () => externalWrite(`Investigate importer in the nightly build ${m}`), { sel: ".tessera-wi-row", text: m }, { manual: true });
  await settle(1500);
}
for (let i = 0; i < runs; i++) {
  const mark = `r${cpu}x${i}${Date.now() % 1000}`;
  // A. external write while the list is visible
  await measure("external-write-list-visible", () => externalWrite(`Investigate importer in the nightly build ${mark}`), { sel: ".tessera-wi-row", text: mark }, { manual: true });
  await settle(1000);

  // B. navigate away (list goes hidden under Activity)
  await measure("nav-away-to-inbox", () => page.locator('nav[aria-label=Work] a[href="/inbox"]').click(), { sel: "[role=main]", text: "Inbox", gone: "[data-list-ready]" });
  await settle(1500);
  const hiddenInfo = await page.evaluate(() => ({ nodes: document.getElementsByTagName("*").length, listVisible: !![...document.querySelectorAll("[data-list-ready]")].find((e) => e.checkVisibility()), lists: document.querySelectorAll("[data-list-ready]").length }));

  // C. external write while the list is hidden
  const mark2 = `${mark}h`;
  await measure("external-write-list-hidden", () => externalWrite(`Investigate importer in the nightly build ${mark2}`), { sel: "[role=main]", text: "Inbox" }, { manual: true });
  await settle(1000);

  // D. navigate back to the list (project link in the sidebar)
  await measure("nav-back-to-list", () => page.locator(`nav[aria-label=Work] a[href="${P}/work-items"]`).click(), { sel: "[data-list-ready]", text: "PERF-" });
  await settle(2000);
  const back = await page.evaluate((m) => ({ stale: !document.body.textContent.includes(m), nodes: document.getElementsByTagName("*").length }), mark2);
  results.back = back;

}
const compact = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, Array.isArray(v) ? (v[0].ltTotal === undefined ? v[0] : { dt: v[0].dt, worked: v[0].worked, commits: v[0].commits, lt: v[0].longTasks, ltTotal: v[0].ltTotal, ltMax: Math.max(0, ...v[0].longTasks), cpuTotal: v[0].cpuTotalMs }) : v]));
console.log(JSON.stringify(compact));
await browser.close();

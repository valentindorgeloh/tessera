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
  execSync(`npx tsx scripts/mcp-call.ts --client ${process.env.CLIENT ?? 'perf-agent-1'} update_work_item '${JSON.stringify({ work_item_id: ITEM, name })}'`, {
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

if (process.env.PREWRITE === "1") externalWrite("Investigate importer in the nightly build prewrite");
await gotoReady(page, `${base}${P}/work-items`);

{
  // First write after a hard load by an actor the app already knows (CLIENT, default perf-agent-1), then a second one.
  for (const name of ["first-write", "second-write"]) {
    const m = `w${name[0]}${Date.now() % 100000}`;
    await measure(name, () => externalWrite(`Investigate importer in the nightly build ${m}`), { sel: ".tessera-wi-row", text: m }, { manual: true });
    await settle(1500);
  }
}
const compact = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { dt: v[0].dt, worked: v[0].worked, commits: v[0].commits, ltTotal: v[0].ltTotal, cpuTotal: v[0].cpuTotalMs }]));
console.log(JSON.stringify(compact));
await browser.close();

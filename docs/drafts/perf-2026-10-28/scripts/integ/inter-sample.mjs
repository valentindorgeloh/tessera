// Interactions on the 10k list (PERF project, default layout, 200 rows). Usage: node interactions.mjs <cpuRate> <runs>
import fs from "node:fs";
import { newPage, gotoReady, load, q, cpuProbe, median } from "./lib.mjs";
const [port, project] = process.argv.slice(2);
const cpu = 1;
const runs = 1;
const base = `http://127.0.0.1:${port}`;
const P = "/projects/" + project;
const { browser, page } = await newPage({ cpu });
const cp = await cpuProbe(browser);
const results = {};
const settle = (quiet = 600) => page.evaluate((qt) => window.__settle(qt, 60000), quiet);

async function measure(name, act, spec) {
  await page.evaluate((s) => window.__arm(s), spec);
  const c0 = await cp.read();
  const wall0 = Date.now();
  await act();
  // wait until armed ready or timeout
  await page.waitForFunction(() => window.__armed && window.__armed.ready !== null, null, { timeout: 120000 }).catch(() => {});
  const c1 = await cp.read();
  await settle();
  const c2 = await cp.read();
  const r = await page.evaluate(() => window.__collect());
  const out = { ...r, cpuToReadyMs: Math.round(c1 - c0), cpuTotalMs: Math.round(c2 - c0), load: load() };
  (results[name] ??= []).push(out);
}

const gl = await gotoReady(page, `${base}${P}/work-items`);

for (let i = 0; i < runs; i++) {
  // 1. selection toggle (client-only state in WorkItemsScreen)
  const row = (n) => page.locator(".tessera-wi-row").nth(n);
  await measure("select-row-checkbox", () => row(3).locator(".tessera-wi-select").first().click({ force: true }), { sel: ".tessera-wi-list--selecting" });
  await settle();
  await measure("deselect", () => row(3).locator(".tessera-wi-select").first().click({ force: true }), { sel: ".tessera-wi-list:not(.tessera-wi-list--selecting)" });
  await settle();

  // 2. open the peek (URL push: server render + list reconcile)
  await measure("peek-open", () => row(5).locator(".tessera-wi-open").click(), { sel: ".tessera-peek-panel .astryx-heading" });
  await settle(1500);
  // 3. change a property inside the list while the peek is open? close peek first
  await measure("peek-close", () => page.keyboard.press("Escape"), { sel: "[data-list-ready]", gone: ".tessera-peek-panel" });
  await settle(1500);

  // 5. state change from the row's selector: open then pick
  await measure("state-open", () => row(7).locator("[role=combobox]").first().click(), { sel: "[role=listbox] [role=option]" });
  await settle();
  await measure("state-pick", async () => {
    const opts = page.locator("[role=listbox]:visible [role=option]");
    await opts.nth(i % 3 === 0 ? 1 : 2).click();
  }, { sel: ".tessera-wi-row" });
  await settle(2500);

}
const compact = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { dt: v[0].dt, cpuReady: v[0].cpuToReadyMs, cpuTotal: v[0].cpuTotalMs, commits: v[0].commits, worked: v[0].worked, lt: v[0].longTasks, ltTotal: v[0].ltTotal, ltMax: Math.max(0, ...v[0].longTasks) }]));
console.log(JSON.stringify(compact));
await browser.close();

// Interactions on the 10k list (PERF project, default layout, 200 rows). Usage: node interactions.mjs <cpuRate> <runs>
import fs from "node:fs";
import { newPage, gotoReady, load, q, cpuProbe, median } from "./lib.mjs";
const cpu = Number(process.argv[2] ?? 1);
const runs = Number(process.argv[3] ?? 3);
const tag = process.argv[4] ?? `cpu${cpu}`;
const base = "http://127.0.0.1:3841";
const P = "/projects/" + (process.env.PROJECT ?? "01a16ad8-6ddd-7752-91fa-653ae8b8a394");
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
  console.log(name, JSON.stringify({ dt: out.dt, cpuReady: out.cpuToReadyMs, cpuTotal: out.cpuTotalMs, commits: out.commits, worked: out.worked, lt: out.longTasks, ev: out.events.map((e) => `${e.type}:${e.dur}`).join(","), top: out.topTypes.slice(0, 4).map((t) => t.join("=")).join(" ") }));
}

console.log("cpu", cpu, "load", load());
const gl = await gotoReady(page, `${base}${P}/work-items`);
console.log("loaded; nodes", await page.evaluate(() => document.getElementsByTagName("*").length));

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

  // 4. Power K
  await measure("powerk-open", () => page.keyboard.press("Meta+k"), { sel: "dialog[open] input" });
  await settle();
  await measure("powerk-type", () => page.keyboard.type("bill"), { sel: "dialog[open] [role=option]" });
  await settle(1500);
  await page.keyboard.press("Escape");
  await settle();

  // 5. state change from the row's selector: open then pick
  await measure("state-open", () => row(7).locator("[role=combobox]").first().click(), { sel: "[role=listbox] [role=option]" });
  await settle();
  await measure("state-pick", async () => {
    const opts = page.locator("[role=listbox]:visible [role=option]");
    await opts.nth(i % 3 === 0 ? 1 : 2).click();
  }, { sel: ".tessera-wi-row" });
  await settle(2500);

  // 6. sidebar collapse and expand
  await measure("sidebar-collapse", () => page.keyboard.press("Meta+b"), { sel: "nav[aria-label=Work]" });
  await settle();
  await measure("sidebar-expand", () => page.keyboard.press("Meta+b"), { sel: "nav[aria-label=Work]" });
  await settle();
}
fs.writeFileSync(new URL(`./out-interactions-${tag}.json`, import.meta.url).pathname, JSON.stringify({ cpu, runs, startedAt: new Date().toISOString(), results }, null, 1));
await browser.close();

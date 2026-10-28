// Does a visited (now hidden) work-items route cost main-thread time on later navigations?
// A: / -> projects -> inbox -> analytics -> projects. B: same, but the work-items list is visited (and settled) first.
// Interleaved A,B,A,B... Records long-task time in the 3 s after each click. Usage: node hidden-route.mjs <set> [rounds=4]
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, median, load } from "./routes.mjs";
import { NAV_INIT } from "./nav-init.mjs";

const set = process.argv[2] ?? "large";
const rounds = Number(process.argv[3] ?? 4);
const { port, project } = SETS[set];
const base = `http://127.0.0.1:${port}`;
const P = `/projects/${project}`;
const browser = await chromium.launch();

async function run(visitList) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(NAV_INIT);
  await page.goto(base + "/", { waitUntil: "load" });
  await page.evaluate(() => window.__settle(1500, 60000));
  const click = async (sel) => {
    const loc = page.locator(sel).filter({ visible: true }).first();
    await loc.waitFor({ state: "visible", timeout: 60000 });
    const before = await page.evaluate(() => performance.now());
    await loc.click({ timeout: 60000 });
    await page.waitForTimeout(3000);
    return page.evaluate((t) => Math.round(window.__lt.filter(([s]) => s >= t).reduce((a, [, d]) => a + d, 0)), before);
  };
  const out = {};
  out.projects = await click('nav a[href="/projects"]');
  if (visitList) {
    await click(`[role="main"] a[href="${P}/work-items"]`);
    await page.locator("[data-list-ready]").filter({ visible: true }).first().waitFor({ timeout: 60000 });
    await page.evaluate(() => window.__settle(1500, 60000));
  }
  out.inbox = await click('nav a[href="/inbox"]');
  out.analytics = await click('nav a[href="/analytics"]');
  out.projects2 = await click('nav a[href="/projects"]');
  out.nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  await context.close();
  return out;
}

const res = { set, loadBefore: load(), A: [], B: [] };
for (let i = 0; i < rounds; i++) {
  res.A.push(await run(false));
  res.B.push(await run(true));
}
res.loadAfter = load();
res.summary = {};
for (const k of ["projects", "inbox", "analytics", "projects2", "nodes"]) res.summary[k] = { A_no_list: median(res.A.map((x) => x[k])), B_list_visited: median(res.B.map((x) => x[k])) };
fs.writeFileSync(new URL(`../results/hidden-route-${set}.json`, import.meta.url), JSON.stringify(res, null, 2));
console.log(res.loadBefore, "->", res.loadAfter);
console.table(res.summary);
await browser.close();

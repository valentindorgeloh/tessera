// In-page A/B of the grouped-scroller rule on one production build: `class` = .tessera-wi-scroller--grouped (after),
// `has` = .tessera-wi-scroller:has(.tessera-wi-group) (base). The selectorText of the two stylesheet rules is swapped through
// the CSSOM, the modes alternate (has, class, has, class...) inside one page session. Metrics: CDP Performance.getMetrics
// deltas (RecalcStyleDuration, LayoutDuration, ScriptDuration, TaskDuration) over each scenario window.
// Usage: node has-recalc.mjs <port> <projectId> <treeDir> <dbPath> <reps>
import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";
const [port, project, tree, db, repsArg] = process.argv.slice(2);
const reps = Number(repsArg ?? 6);
const ITEM = "01a16ad8-6e4e-7608-a668-b8fe28aba5f1";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const pick = (a, b) => ({ style: (b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000, styleN: b.RecalcStyleCount - a.RecalcStyleCount, layout: (b.LayoutDuration - a.LayoutDuration) * 1000, script: (b.ScriptDuration - a.ScriptDuration) * 1000, task: (b.TaskDuration - a.TaskDuration) * 1000 });
await page.goto(`http://127.0.0.1:${port}/projects/${project}/work-items`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForSelector("[data-list-ready]", { timeout: 90000 });
await page.waitForTimeout(2500);
const setMode = (mode) => page.evaluate((mode) => {
  const want = mode === "has" ? ".tessera-wi-scroller:has(.tessera-wi-group)" : ".tessera-wi-scroller--grouped";
  const from = mode === "has" ? ".tessera-wi-scroller--grouped" : ".tessera-wi-scroller:has(.tessera-wi-group)";
  let n = 0;
  const walk = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText === from) { r.selectorText = want; n++; } } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  return n;
}, mode);
const frames = (n = 2) => page.evaluate((n) => new Promise((res) => { const f = (k) => (k ? requestAnimationFrame(() => f(k - 1)) : res()); f(n); }), n);
const window_ = async (act) => { const a = await metrics(); await act(); const b = await metrics(); return pick(a, b); };
const scenarios = {
  // 40 DOM insert/remove pairs inside the first row: pure selector re-check cost, no React.
  mutate: () => page.evaluate(async () => {
    const row = document.querySelector(".tessera-wi-row");
    for (let i = 0; i < 40; i++) { const el = document.createElement("i"); row.appendChild(el); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); el.remove(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  }),
  // collapse + expand the first group with the real control.
  toggle: async () => {
    const t = page.locator(".tessera-wi-group button[aria-expanded]").first();
    await t.click(); await page.waitForTimeout(700); await t.click(); await page.waitForTimeout(900);
  },
  // an MCP agent write while the list is open: the server renders the page again and ChangesPoller refreshes it.
  write: async () => {
    const mark = `m${Date.now() % 1e6}`;
    execSync(`npx tsx scripts/mcp-call.ts --client perf-agent-1 update_work_item '${JSON.stringify({ work_item_id: ITEM, name: `Investigate importer in the nightly build ${mark}` })}'`, { cwd: tree, env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}`, TESSERA_DB_PATH: db }, stdio: "ignore" });
    await page.waitForFunction((m) => document.body.textContent.includes(m), mark, { timeout: 30000, polling: 100 }).catch(() => {});
    await page.waitForTimeout(2500);
  },
};
const out = { reps, load: execSync("uptime").toString().trim().replace(/.*load averages?: /, ""), results: {} };
for (const [name, act] of Object.entries(scenarios)) {
  const res = { has: [], class: [] };
  for (let i = 0; i < reps; i++) {
    for (const mode of ["has", "class"]) {
      const swapped = await setMode(mode);
      await frames(3); await page.waitForTimeout(500);
      const r = await window_(act);
      res[mode].push({ ...r, swapped });
    }
  }
  out.results[name] = res;
}
console.log(JSON.stringify(out));
await browser.close();

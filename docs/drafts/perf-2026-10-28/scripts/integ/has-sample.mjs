// Skeptic probe: inbox -> list navigation with :has() rules removed through CSSOM before the click.
// Modes: has (none removed), all (every :has rule), tessera (rules whose selector does not start with a StyleX atomic
// class, i.e. Tessera's own), astryx (only the StyleX atomic ones). Usage: node has-split.mjs <port> <projectId> <mode>
import { chromium } from "@playwright/test";
import { INIT } from "./perf-init.mjs";
const [port, project] = process.argv.slice(2);
const mode = "has";
const BASE = `http://127.0.0.1:${port}`;
const LIST = `/projects/${project}/work-items`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(INIT, null);
await page.goto(BASE + "/inbox", { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(1500);
const info = await page.evaluate((mode) => {
  const isAtomic = (sel) => /^\.x[a-z0-9]+[.:]/.test(sel.trim());
  const pick = (sel) => (mode.startsWith("sub:") && mode.slice(4).split("|").some((t) => sel.includes(t))) || mode === "all" || (mode === "tessera" && !isAtomic(sel)) || (mode === "astryx" && isAtomic(sel));
  let removed = 0;
  const kept = [];
  const walk = (list, owner) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules, r);
      else if (r.selectorText && r.selectorText.includes(":has(")) {
        if (mode !== "has" && pick(r.selectorText)) { owner.deleteRule(i); removed++; }
        else kept.push(r.selectorText.slice(0, 60));
      }
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules, s); } catch {} }
  return { removed, kept: kept.length };
}, mode);
const t1 = await page.evaluate(() => performance.now());
const before = page.url();
const t0 = Date.now();
await page.locator(`a[href="${LIST}"]`).first().click();
while (page.url() === before && Date.now() - t0 < 120000) await page.waitForTimeout(5);
await page.waitForFunction(() => !!window.__perfReadyEl?.("[data-list-ready]"), null, { timeout: 120000, polling: 16 });
const readyMs = Date.now() - t0;
await page.waitForTimeout(800);
const lt = await page.evaluate((t1) => window.__perf.lt.filter(([s]) => s >= t1).reduce((a, [, d]) => a + d, 0), t1);
const rows = await page.evaluate(() => document.querySelectorAll(".tessera-wi-row").length);
console.log(JSON.stringify({ mode, ...info, readyMs, lt, rows }));
await browser.close();

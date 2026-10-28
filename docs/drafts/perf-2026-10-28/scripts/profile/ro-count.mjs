import fs from "node:fs";
import { chromium } from "playwright"; import { SETS, RES, layoutPath } from "./common.mjs";
const b = await chromium.launch(); const out = {};
for (const [set, kind] of [["small", "list"], ["large", "list"], ["large", "table"], ["small", "inbox"]]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { window.__ro = []; const o = ResizeObserver.prototype.observe; ResizeObserver.prototype.observe = function (el, opts) { try { window.__ro.push({ tag: el.tagName, cls: (el.className?.toString?.() || "").split(" ").filter((c) => /^(astryx|tessera)/.test(c)).join(" ").slice(0, 60), text: (el.textContent || "").slice(0, 30), inMain: !!el.closest('[role="main"]'), inNav: !!el.closest("nav"), inHeader: !!el.closest('header,[role="banner"]'), row: !!el.closest(".tessera-wi-row"), td: !!el.closest("td,[role=cell]") }); } catch {} return o.call(this, el, opts); }; });
  const url = kind === "inbox" ? "/inbox" : layoutPath(set, kind);
  await page.goto(`http://127.0.0.1:${SETS[set].port}${url}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const a = window.__ro; const g = {}; for (const x of a) { const k = `${x.inNav ? "nav" : x.inHeader ? "header" : x.row ? "row" : x.td ? "cell" : x.inMain ? "main-other" : "other"} ${x.tag} ${x.cls}`; g[k] = (g[k] ?? 0) + 1; } return { total: a.length, groups: Object.entries(g).sort((x, y) => y[1] - x[1]).slice(0, 14), sample: a.slice(0, 4) }; });
  out[`${set}/${kind}`] = r; console.log(set, kind, JSON.stringify(r));
  await ctx.close();
}
fs.writeFileSync(`${RES}/profile-resizeobserver-census.json`, JSON.stringify(out, null, 1)); await b.close();

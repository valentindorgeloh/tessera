import { chromium } from "playwright";
import { SETS, layoutPath } from "./common.mjs";
const set = process.argv[2] ?? "small";
const w = Number(process.argv[3] ?? 1440);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: w > 600 ? 900 : 812 } });
const page = await ctx.newPage();
const base = `http://127.0.0.1:${SETS[set].port}`;
await page.goto(base + layoutPath(set, "list"), { waitUntil: "networkidle" });
await page.waitForSelector("[data-list-ready]");
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const row = document.querySelector(".tessera-wi-row");
  const cnt = (sel, root = document) => root.querySelectorAll(sel).length;
  const all = (root) => ({
    el: root.getElementsByTagName("*").length,
    listbox: cnt('[role="listbox"]', root), tooltip: cnt('[role="tooltip"]', root), popover: cnt("[popover]", root), dialog: cnt("dialog", root),
    popoverDiv: cnt("[data-astryx-popover],[data-popover]", root), button: cnt("button", root), svg: cnt("svg", root), combobox: cnt('[role="combobox"]', root), menu: cnt('[role="menu"]', root),
  });
  const nav = [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href")).slice(0, 60);
  return { rows: document.querySelectorAll(".tessera-wi-row").length, doc: all(document), row: row && all(row), rowHtml: row?.outerHTML.length, rowHtmlHead: row?.outerHTML.slice(0, 3000), nav, listReady: document.querySelectorAll("[data-list-ready]").length };
});
console.log(JSON.stringify({ ...r, rowHtmlHead: undefined, nav: r.nav }, null, 1));
console.log(r.rowHtmlHead);
await page.screenshot({ path: `/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc/results/explore-${set}-${w}.png` });
await b.close();

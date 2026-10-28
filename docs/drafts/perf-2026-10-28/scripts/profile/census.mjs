// DOM census by owner: rows, closed layers (popover/listbox/tooltip), shell, per row. usage: node census.mjs <set> <path-kind>
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, RES, layoutPath } from "./common.mjs";
const b = await chromium.launch();
const out = {};
for (const set of ["small", "large"]) for (const kind of ["list", "table", "list-state", "board-state"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  const [lay, grp] = kind === "list" ? ["list", null] : kind === "table" ? ["table", null] : kind === "list-state" ? ["list", "state"] : ["board", "state"];
  await page.goto(`http://127.0.0.1:${SETS[set].port}${layoutPath(set, lay, grp)}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector("[data-list-ready]"); await page.waitForTimeout(1500);
  out[`${set}/${kind}`] = await page.evaluate(() => {
    const all = [...document.getElementsByTagName("*")];
    const total = all.length;
    const pop = [...document.querySelectorAll("[popover]")];
    const inPopover = new Set(); for (const p of pop) { inPopover.add(p); p.querySelectorAll("*").forEach((e) => inPopover.add(e)); }
    const rows = [...document.querySelectorAll(".tessera-wi-row, tbody tr, [role=row], .tessera-board-card, [data-board-card]")];
    const rowSet = new Set(); for (const r of rows) { rowSet.add(r); r.querySelectorAll("*").forEach((e) => rowSet.add(e)); }
    const lb = document.querySelectorAll('[role="listbox"]'); const tt = document.querySelectorAll('[role="tooltip"]');
    const popKinds = {}; for (const p of pop) { const k = p.querySelector('[role="listbox"]') ? "listbox" : p.matches('[role="tooltip"]') || p.querySelector('[role="tooltip"]') ? "tooltip" : p.querySelector("[role=dialog],dialog") ? "dialog" : p.querySelector('[role="menu"]') ? "menu" : "other"; popKinds[k] = (popKinds[k] ?? 0) + 1; }
    const popEls = pop.reduce((a, p) => a + p.getElementsByTagName("*").length + 1, 0);
    const rowEls = [...rowSet].length;
    const lbEls = [...lb].reduce((a, p) => a + p.getElementsByTagName("*").length + 1, 0);
    // where are popovers attached?
    const parents = {}; for (const p of pop.slice(0, 400)) { const par = p.parentElement; const k = par ? (par.className?.toString().split(" ").find((c) => c.startsWith("tessera-") || c.startsWith("astryx-")) || par.tagName) : "none"; parents[k] = (parents[k] ?? 0) + 1; }
    const rowCount = document.querySelectorAll(".tessera-wi-row").length || document.querySelectorAll("tbody tr").length;
    const options = document.querySelectorAll('[role="option"]').length;
    const sample = pop[0]?.outerHTML.slice(0, 600);
    return { total, rowCount, rowElements: rowEls, popoverCount: pop.length, popoverKinds: popKinds, popoverElements: popEls, listboxCount: lb.length, listboxElements: lbEls, optionCount: options, tooltipCount: tt.length, dialogs: document.querySelectorAll("dialog").length, parents, svg: document.querySelectorAll("svg").length, buttons: document.querySelectorAll("button").length, inputs: document.querySelectorAll("input").length, sample };
  });
  const o = out[`${set}/${kind}`]; console.log(set, kind, JSON.stringify({ ...o, sample: undefined }));
  await ctx.close();
}
fs.writeFileSync(`${RES}/profile-census.json`, JSON.stringify(out, null, 1));
await b.close();

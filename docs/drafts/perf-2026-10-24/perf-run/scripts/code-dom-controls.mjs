// MEASURE-CODE: DOM nodes inside hidden popovers of the work-items list, by the kind of content. Usage: node code-dom-controls.mjs <port> <path> <out.json>
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [port, path, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForSelector("[data-list-ready]", { timeout: 60000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const list = document.querySelector("[data-list-ready]");
  const pops = [...list.querySelectorAll("[popover]")].filter((p) => !p.matches(":popover-open"));
  const top = pops.filter((p) => !p.parentElement.closest("[popover]"));
  const kinds = {};
  for (const p of top) {
    const n = p.getElementsByTagName("*").length + 1;
    const kind = p.getAttribute("role") === "tooltip" ? "tooltip" : p.querySelector('[role="grid"]') ? "date popover (calendar grid)" : p.querySelector('[role="listbox"]') ? "selector listbox" : p.querySelector('[role="menu"]') ? "menu" : "other";
    kinds[kind] ??= { count: 0, nodes: 0 };
    kinds[kind].count++;
    kinds[kind].nodes += n;
  }
  const gridcells = list.querySelectorAll('[role="gridcell"]').length;
  const rows = list.querySelectorAll('[data-wi-row], [role="listitem"], li').length;
  return { listNodes: list.getElementsByTagName("*").length, docNodes: document.getElementsByTagName("*").length, closedTopPopovers: top.length, kinds, gridcells, rowsLi: rows };
});
console.log(JSON.stringify(r, null, 1));
fs.writeFileSync(out, JSON.stringify({ path, ...r }, null, 2));
await browser.close();

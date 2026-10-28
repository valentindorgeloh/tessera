import { chromium } from "@playwright/test";
const [port, project, groupBy] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const out = {};
for (const layout of ["list", "table"]) {
  const q = Buffer.from(JSON.stringify({ display: { layout, group_by: groupBy === "none" ? null : "state" } })).toString("base64url");
  await p.goto(`http://127.0.0.1:${port}/projects/${project}/work-items?q=${q}`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForSelector("[data-list-ready]", { timeout: 60000 }); await p.waitForTimeout(800);
  out[layout] = await p.evaluate(() => ({ rows: document.querySelectorAll(".tessera-wi-row").length, roleRows: document.querySelectorAll('[role="row"]').length, nodes: document.getElementsByTagName("*").length }));
}
console.log(JSON.stringify(out)); await b.close();

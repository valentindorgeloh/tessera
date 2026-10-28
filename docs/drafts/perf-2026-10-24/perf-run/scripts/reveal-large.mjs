// How much of the LARGE hard-load time to a visible list is the client's own work? Same URL, warm HTTP cache,
// 1440 no throttle: "normal" vs "chunks blocked" (every /_next/static/chunks/*.js aborted, so only the streamed HTML
// and React's inline reveal scripts run). Interleaved normal/blocked per round. Usage: node reveal-large.mjs [rounds=5]
import fs from "node:fs";
import { chromium } from "playwright";
import { INIT } from "./perf-init.mjs";
import { SETS, median, load } from "./routes.mjs";

const rounds = Number(process.argv[2] ?? 5);
const { port, project } = SETS.large;
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const P = `http://127.0.0.1:${port}/projects/${project}/work-items`;
const URLS = {
  "wi-list": P,
  "wi-list-state": `${P}?q=${q({ layout: "list", group_by: "state" })}`,
  "wi-board-state": `${P}?q=${q({ layout: "board", group_by: "state" })}`,
  "wi-table-state": `${P}?q=${q({ layout: "table", group_by: "state" })}`,
};
const browser = await chromium.launch();
const res = { loadBefore: load(), rows: [] };
for (let i = 0; i < rounds; i++) {
  for (const [name, url] of Object.entries(URLS)) {
    for (const block of i % 2 ? [true, false] : [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      if (block) await ctx.route(/\/_next\/static\/chunks\/.*\.js$/, (r) => r.abort());
      const page = await ctx.newPage();
      await page.addInitScript(INIT, "[data-list-ready]");
      await page.goto(url, { waitUntil: "load", timeout: 120_000 });
      await page.waitForFunction(() => window.__perf.ready !== null, null, { timeout: 120_000 });
      const r = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return { ttfb: Math.round(n.responseStart), respEnd: Math.round(n.responseEnd), fcp: Math.round(window.__perf.fcp), ready: Math.round(window.__perf.ready) };
      });
      res.rows.push({ round: i, name, block, ...r });
      await ctx.close();
    }
  }
  process.stdout.write(`round ${i + 1} load ${load()}\n`);
}
res.loadAfter = load();
res.summary = {};
for (const name of Object.keys(URLS)) {
  for (const block of [false, true]) {
    const rows = res.rows.filter((r) => r.name === name && r.block === block);
    res.summary[`${name} ${block ? "chunks blocked" : "normal"}`] = {
      ready: median(rows.map((r) => r.ready)),
      fcp: median(rows.map((r) => r.fcp)),
      ttfb: median(rows.map((r) => r.ttfb)),
      respEnd: median(rows.map((r) => r.respEnd)),
      n: rows.length,
    };
  }
}
fs.writeFileSync(new URL("../results/reveal-large.json", import.meta.url), JSON.stringify(res, null, 2));
console.log(res.loadBefore, "->", res.loadAfter);
console.table(res.summary);
await browser.close();

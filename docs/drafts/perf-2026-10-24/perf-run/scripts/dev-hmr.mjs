// MEASURE-DEV (e): HMR timing. Opens a route, then appends a comment line to a component file in the COPY n times and
// times: write -> "[Fast Refresh] rebuilding", write -> "[Fast Refresh] done in N ms" (and N itself), the server's
// "Compiled in X" line, and whether the page did a full reload (window marker lost / main-frame navigation).
// The file is restored at the end. Usage: node dev-hmr.mjs <port> <logfile> <copyDir> <relFile> <route> <n> <out.json>
import fs from "node:fs";
import { chromium } from "playwright";
import { logSize, logSince, median, load, sleep } from "./dev-common.mjs";
import { DEV_INIT } from "./dev-init.mjs";

const [port, logFile, copy, rel, route, nArg, out] = process.argv.slice(2);
if (!copy.includes("/scratchpad/perf/")) throw new Error("refusing to edit outside the scratch copy");
const file = `${copy}/${rel}`;
const original = fs.readFileSync(file, "utf8");
const n = Number(nArg);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(DEV_INIT);
const events = [];
page.on("console", (m) => { const t = m.text(); if (t.startsWith("[Fast Refresh]")) events.push({ at: Date.now(), t }); });
let navs = 0;
page.on("framenavigated", (f) => { if (f === page.mainFrame()) navs++; });
await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "load", timeout: 300_000 });
await page.evaluate(() => window.__watchReady(null));
await page.waitForFunction(() => window.__p.hydrated !== null, null, { timeout: 120_000 });
await sleep(3000);
const rows = [];
const result = { port, rel, route, n, loadBefore: load(), rows };
try {
  for (let k = 1; k <= n; k++) {
    await page.evaluate(() => { window.__hmrMark = 1; });
    const navs0 = navs;
    const ev0 = events.length;
    const pos = logSize(logFile);
    const t0 = Date.now();
    fs.writeFileSync(file, original + `\n// hmr-probe ${k} ${t0}\n`);
    let done = null, rebuilding = null, compiled = null;
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      const ev = events.slice(ev0);
      rebuilding ??= ev.find((e) => e.t.includes("rebuilding"));
      done ??= ev.find((e) => e.t.includes("done in"));
      const lines = logSince(logFile, pos);
      compiled ??= lines.find((l) => /Compiled in/.test(l)) ?? null;
      if ((done || navs > navs0) && compiled) break;
      await sleep(25);
    }
    await sleep(1500);
    const mark = await page.evaluate(() => window.__hmrMark ?? null).catch(() => null);
    const lines = logSince(logFile, pos).filter((l) => /Compiled|GET|POST|reload|⚠|rror/.test(l)).slice(0, 8);
    const row = {
      k,
      toRebuilding: rebuilding ? rebuilding.at - t0 : null,
      toDone: done ? done.at - t0 : null,
      doneInReported: done ? Number(/done in (\d+)ms/.exec(done.t)?.[1]) : null,
      serverCompiled: compiled ? compiled.trim() : null,
      serverCompiledMs: compiled ? (/in ([\d.]+)(ms|s)/.exec(compiled) ? Number(RegExp.$1) * (RegExp.$2 === "s" ? 1000 : 1) : null) : null,
      fullReload: mark === null || navs > navs0,
      lines,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    await sleep(2000);
  }
} finally {
  fs.writeFileSync(file, original);
}
await sleep(3000);
result.loadAfter = load();
result.summary = {
  n: rows.length,
  toDone_med: median(rows.map((r) => r.toDone)),
  doneInReported_med: median(rows.map((r) => r.doneInReported)),
  serverCompiled_med: median(rows.map((r) => r.serverCompiledMs)),
  fullReloads: rows.filter((r) => r.fullReload).length,
};
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(result.summary, result.loadBefore, result.loadAfter);
await browser.close();

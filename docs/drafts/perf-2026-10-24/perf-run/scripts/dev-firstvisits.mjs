// MEASURE-DEV (a)/(b)/(c): full page loads of every route in user order against a server, pairing each load with
// the dev log line for its document request. Usage:
//   node dev-firstvisits.mjs <port> <logfile> <small|large> <out.json> [passes=1] [label]
// passes>1 repeats the whole route list (round-robin) for steady-state medians.
import fs from "node:fs";
import { chromium } from "playwright";
import { routesFor, logSize, waitLogReq, load, median, pct, sleep } from "./dev-common.mjs";
import { DEV_INIT } from "./dev-init.mjs";

const [port, logFile, set, out, passesArg, label] = process.argv.slice(2);
const passes = Number(passesArg ?? 1);
const BASE = `http://127.0.0.1:${port}`;
const only = process.env.ROUTES ? process.env.ROUTES.split(",") : null;
const routes = routesFor(set).filter(([name]) => !only || only.includes(name));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleMsgs = [];
let current = "start";
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleMsgs.push({ route: current, type: m.type(), text: m.text().slice(0, 600) });
});
page.on("pageerror", (e) => consoleMsgs.push({ route: current, type: "pageerror", text: String(e).slice(0, 600) }));
await page.addInitScript(DEV_INIT);

const result = { port, set, label, passes, startedAt: new Date().toISOString(), loadBefore: load(), rows: [], console: consoleMsgs };
for (let pass = 0; pass < passes; pass++) {
  for (const [name, path, sel] of routes) {
    current = name;
    const noLog = logFile === "none";
    const pos = noLog ? 0 : logSize(logFile);
    const t0 = Date.now();
    let err = null;
    try {
      await page.goto(BASE + path, { waitUntil: "commit", timeout: 300_000 });
      await page.evaluate((s) => window.__watchReady(s), sel);
      await page.waitForFunction(() => window.__p.ready !== null, null, { timeout: 300_000, polling: 50 });
    } catch (e) {
      err = String(e).slice(0, 200);
    }
    const wall = Date.now() - t0;
    await page.waitForFunction(() => window.__p.hydrated !== null, null, { timeout: 60_000, polling: 50 }).catch(() => {});
    const p = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return {
        ready: window.__p.ready && Math.round(window.__p.ready),
        hydrated: window.__p.hydrated && Math.round(window.__p.hydrated),
        fcp: window.__p.fcp && Math.round(window.__p.fcp),
        lcp: window.__p.lcp && Math.round(window.__p.lcp),
        ttfb: n && Math.round(n.responseStart),
        docEnd: n && Math.round(n.responseEnd),
        dcl: n && Math.round(n.domContentLoadedEventEnd),
        lt: Math.round(window.__p.lt.reduce((a, [, d]) => a + d, 0)),
        ltCount: window.__p.lt.length,
        js: performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script").length,
        jsKB: Math.round(performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script").reduce((a, e) => a + (e.decodedBodySize || 0), 0) / 1024),
      };
    }).catch(() => ({}));
    // The document request line (url exact) in the dev log.
    const { hit, lines } = noLog ? { hit: null, lines: [] } : await waitLogReq(logFile, pos, (r) => r.url === path && r.method === "GET", 30_000);
    const extra = lines.filter((l) => !/^\s*(GET|POST|HEAD) /.test(l)).slice(0, 12);
    const others = lines.map((l) => l.trim()).filter((l) => /^(GET|POST|HEAD) /.test(l) && !l.startsWith(`GET ${path} `)).slice(0, 12);
    result.rows.push({ pass, name, path, wall, err, browser: p, log: hit, logExtra: extra, otherRequests: others });
    const parts = hit ? Object.entries(hit.parts).map(([k, v]) => `${k}=${v}`).join(" ") : "no log line";
    console.log(`${pass} ${name.padEnd(16)} wall ${String(wall).padStart(6)}  ready ${p.ready}  log total ${hit?.total} (${parts})${err ? " ERR " + err : ""}`);
    await sleep(300);
  }
}
result.loadAfter = load();
if (passes > 1) {
  result.summary = {};
  for (const [name] of routes) {
    const rows = result.rows.filter((r) => r.name === name && r.pass > 0 || (passes === 1 && r.name === name));
    const rr = result.rows.filter((r) => r.name === name);
    const use = rr.slice(1); // drop the first pass (compile)
    result.summary[name] = {
      n: use.length,
      server_total_med: median(use.map((r) => r.log?.total)),
      server_total_p95: pct(use.map((r) => r.log?.total), 95),
      app_code_med: median(use.map((r) => r.log?.parts?.["application-code"])),
      nextjs_med: median(use.map((r) => r.log?.parts?.["next.js"])),
      genparams_med: median(use.map((r) => r.log?.parts?.["generate-params"])),
      ready_med: median(use.map((r) => r.browser?.ready)),
      wall_med: median(use.map((r) => r.wall)),
    };
    void rows;
  }
  console.table(result.summary);
}
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`load before ${result.loadBefore} after ${result.loadAfter}; console msgs ${consoleMsgs.length}`);
await browser.close();

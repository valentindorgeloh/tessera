// MEASURE-DEV (d): client navigation Home -> Projects -> Work items -> Cycles -> Inbox -> Analytics -> Home as sidebar/tab
// clicks, click-to-ready per step, against one or more servers with interleaved rounds (A,B,A,B...).
// Each round: fresh browser context at 1440x900, hard load of /, wait for hydration and quiet, then the six clicks.
// Per step it records click-to-ready, the RSC fetch (start / first byte / end relative to the click, resource timing),
// long tasks, prefetch requests seen (CDP Network, next-router-prefetch / segment-prefetch headers) and, for a dev target,
// the dev-log line of the navigation request (server total and its parts).
// Usage: node dev-nav.mjs <set> <rounds> <warmup> <cpu: 1|4> <out.json> <name:port[:logfile]>...
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, median, pct, load, logSize, logSince, parseReq, sleep } from "./dev-common.mjs";
import { DEV_INIT } from "./dev-init.mjs";

const [set, roundsArg, warmArg, cpuArg, out, ...targetArgs] = process.argv.slice(2);
const rounds = Number(roundsArg), warmup = Number(warmArg), cpu = Number(cpuArg);
const targets = targetArgs.map((t) => { const [name, port, log] = t.split(":"); return { name, port, log }; });
const P = `/projects/${SETS[set].project}`;
const STEPS = [
  { name: "home->projects", click: 'nav a[href="/projects"]', target: "/projects", ready: { path: "/projects", sel: `[role="main"] a[href="${P}/work-items"]` } },
  { name: "projects->work-items", click: `[role="main"] a[href="${P}/work-items"]`, target: `${P}/work-items`, ready: { path: `${P}/work-items`, sel: "[data-list-ready]" } },
  { name: "work-items->cycles", click: `[role="main"] a[href="${P}/cycles"]`, target: `${P}/cycles`, ready: { path: `${P}/cycles`, sel: `[role="main"] a[href^="${P}/cycles/"]` } },
  { name: "cycles->inbox", click: 'nav a[href="/inbox"]', target: "/inbox", ready: { path: "/inbox", sel: '[role="main"] h2', text: "Select a notification" } },
  { name: "inbox->analytics", click: 'nav a[href="/analytics"]', target: "/analytics", ready: { path: "/analytics*", sel: '[role="main"] h2', text: "Work items by state group" } },
  { name: "analytics->home", click: 'nav a[href="/"]', clickText: "Home", target: "/", ready: { path: "/", sel: '[role="main"] h4', text: "Since you were last here" } },
];
const MAX = cpu > 1 ? 120_000 : 60_000;
const browser = await chromium.launch();
const consoleMsgs = [];

async function round(t, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let where = "load";
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleMsgs.push({ target: t.name, label, where, type: m.type(), text: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => consoleMsgs.push({ target: t.name, label, where, type: "pageerror", text: String(e).slice(0, 300) }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const reqs = [];
  cdp.on("Network.requestWillBeSent", (e) => {
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (!("rsc" in h) && !("next-router-prefetch" in h) && !("next-router-segment-prefetch" in h)) return;
    reqs.push({ id: e.requestId, path: new URL(e.request.url).pathname, prefetch: "next-router-prefetch" in h || "next-router-segment-prefetch" in h, at: Date.now() });
  });
  await page.addInitScript(() => { try { performance.setResourceTimingBufferSize(20000); } catch {} });
  if (t.name.includes("nothrottle")) {
    // Experiment: React's Suspense reveal throttle (FALLBACK_THROTTLE_MS = 300) set to 0 in the prod react-dom chunk.
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      if (body.includes("+300-eb())") || body.includes("300>eb()-uX")) {
        body = body.replace("uX+300-eb()", "uX+0-eb()").replace("300>eb()-uX", "0>eb()-uX");
        t.patched = (t.patched ?? 0) + 1;
      }
      await route.fulfill({ response: resp, body });
    });
  }
  await page.addInitScript(DEV_INIT);
  const base = `http://127.0.0.1:${t.port}`;
  await page.goto(base + "/", { waitUntil: "load", timeout: 300_000 });
  await page.waitForFunction(() => !!window.__readyEl('[role="main"] h4', "Since you were last here"), null, { timeout: 300_000, polling: 100 });
  await page.waitForFunction(() => { const el = document.querySelector('nav a[href="/projects"]'); return el && Object.keys(el).some((k) => k.startsWith("__reactFiber")); }, null, { timeout: 120_000, polling: 100 });
  await page.evaluate((max) => window.__settle(1500, max), MAX);
  const rows = [];
  for (const step of STEPS) {
    where = step.name;
    await sleep(1500); // time for viewport prefetches (production only) of the newly shown links
    let loc = page.locator(step.click).filter({ visible: true });
    if (step.clickText) loc = loc.filter({ hasText: step.clickText });
    loc = loc.first();
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    const pos = t.log ? logSize(t.log) : 0;
    const prefetchBefore = reqs.filter((r) => r.prefetch && (r.path === step.target || r.path.startsWith(step.target + "/"))).length;
    await page.evaluate((spec) => window.__arm(spec), step.ready);
    const clickAt = Date.now();
    await loc.click({ timeout: MAX });
    const ok = await page.waitForFunction(() => window.__nav.dt !== null, null, { timeout: MAX, polling: 20 }).then(() => true, () => false);
    const nav = await page.evaluate(() => ({ dt: window.__nav.dt, lt: window.__nav.lt, rsc: window.__nav.rsc }));
    const busyAfter = await page.evaluate((max) => window.__settle(1000, max), MAX);
    // Long-task entries reach the observer after the task ends, so read them only after the settle.
    nav.lt = await page.evaluate(() => { const t0 = window.__nav.t0, r = window.__nav.ready; return Math.round(window.__p.lt.filter(([s, d]) => s + d > t0 && s < r).reduce((a, [s, d]) => a + Math.min(s + d, r) - Math.max(s, t0), 0)); });
    nav.ltMax = await page.evaluate(() => { const t0 = window.__nav.t0, r = window.__nav.ready; return Math.round(Math.max(0, ...window.__p.lt.filter(([s, d]) => s + d > t0 && s < r).map(([, d]) => d))); });
    let server = null;
    if (t.log) {
      await sleep(200);
      const lines = logSince(t.log, pos).map(parseReq).filter(Boolean);
      const hit = lines.find((r) => r.url === step.target || r.url.startsWith(step.target + "?") || (step.target === "/analytics" && r.url.startsWith("/analytics")));
      server = hit ? { url: hit.url, status: hit.status, total: hit.total, parts: hit.parts } : null;
      if (step.target === "/analytics") server = lines.filter((r) => r.url.startsWith("/analytics")).map((h) => ({ url: h.url, status: h.status, total: h.total, parts: h.parts }));
    }
    const navReqs = reqs.filter((r) => !r.prefetch && r.at >= clickAt - 5 && (r.path === step.target || r.path.startsWith(step.target)));
    const rsc = (nav.rsc ?? []).filter((r) => r.url.split("?")[0] === step.target || r.url.split("?")[0].startsWith(step.target === "/" ? "/?" : step.target));
    const first = rsc[0] ?? null;
    rows.push({
      step: step.name, ok, clickToReady: nav.dt === null ? null : Math.round(nav.dt), longTasks: nav.lt, longTaskMax: nav.ltMax, busyAfter,
      rsc: rsc, rscStart: first?.start ?? null, rscTtfb: first?.ttfb ?? null, rscEnd: rsc.length ? Math.max(...rsc.map((r) => r.end)) : null,
      clientAfterRsc: first && nav.dt !== null ? Math.round(nav.dt - Math.max(...rsc.map((r) => r.end))) : null,
      prefetchedBefore: prefetchBefore, navRscRequests: navReqs.length, server,
    });
  }
  const prefetchTotal = reqs.filter((r) => r.prefetch).length;
  await context.close();
  return { rows, prefetchTotal };
}

const result = { set, rounds, warmup, cpu, targets, startedAt: new Date().toISOString(), batches: [] };
for (let i = 0; i < warmup + rounds; i++) {
  const order = targets; // A,B,A,B...
  for (const t of order) {
    const lb = load();
    const r = await round(t, `${i < warmup ? "warm" : "r"}${i}`);
    result.batches.push({ i, warmup: i < warmup, target: t.name, load: lb, ...r });
    console.log(`${i < warmup ? "warmup" : "round"} ${i} ${t.name} load ${lb} :: ` + r.rows.map((x) => `${x.step.split("->")[1]}=${x.clickToReady}`).join(" ") + ` prefetches=${r.prefetchTotal}`);
  }
}
result.loadAfter = load();
result.summary = {};
for (const t of targets) {
  for (const step of STEPS) {
    const rows = result.batches.filter((b) => !b.warmup && b.target === t.name).map((b) => b.rows.find((r) => r.step === step.name));
    const sv = rows.map((r) => (Array.isArray(r.server) ? r.server.reduce((a, s) => a + s.total, 0) : r.server?.total));
    result.summary[`${t.name} ${step.name}`] = {
      n: rows.filter((r) => r.ok).length,
      click_to_ready: median(rows.map((r) => r.clickToReady)),
      p95: pct(rows.map((r) => r.clickToReady), 95),
      rsc_start: median(rows.map((r) => r.rscStart)),
      rsc_ttfb: median(rows.map((r) => r.rscTtfb)),
      rsc_end: median(rows.map((r) => r.rscEnd)),
      client_after_rsc: median(rows.map((r) => r.clientAfterRsc)),
      long_tasks: median(rows.map((r) => r.longTasks)),
      long_task_max: median(rows.map((r) => r.longTaskMax)),
      server_total: median(sv),
      prefetched_before: median(rows.map((r) => r.prefetchedBefore)),
    };
  }
  result.summary[`${t.name} prefetch requests per round`] = { median: median(result.batches.filter((b) => !b.warmup && b.target === t.name).map((b) => b.prefetchTotal)) };
}
result.console = consoleMsgs;
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.table(result.summary);
console.log(`load after ${result.loadAfter}; console msgs ${consoleMsgs.length}`);
await browser.close();

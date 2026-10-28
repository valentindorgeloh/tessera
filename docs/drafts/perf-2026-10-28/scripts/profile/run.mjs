// Profiler harness. node run.mjs <mode> <set> <vp> <scenario> <n> <tag> [variant]
//  mode: plain | react | cpu | trace     set: small|large     vp: d (1440, CPU 1x) | m (375, CPU 4x)
//  scenario: list | table | list-state | table-state | board-state | nav-list | light-cycles | light-inbox | light-analytics
// Writes RES/profile-<tag>.json (+ raw .cpuprofile / .trace.json files next to it for cpu/trace).
import fs from "node:fs";
import { chromium } from "playwright";
import { INIT } from "./init.mjs";
import { SETS, RES, layoutPath, load, median, pct } from "./common.mjs";

const [mode, set, vp, scenario, nArg, tag, variant = "prod"] = process.argv.slice(2);
const n = Number(nArg ?? 5);
const { port, project } = SETS[set];
const BASE = `http://127.0.0.1:${port}`;
const mobile = vp === "m";
const view = mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 };
const cpuRate = mobile ? 4 : 1;
const P = `/projects/${project}`;
const SC = {
  list: { path: layoutPath(set, "list"), ready: "[data-list-ready]" },
  table: { path: layoutPath(set, "table"), ready: "[data-list-ready]" },
  "list-state": { path: layoutPath(set, "list", "state"), ready: "[data-list-ready]" },
  "table-state": { path: layoutPath(set, "table", "state"), ready: "[data-list-ready]" },
  "board-state": { path: layoutPath(set, "board", "state"), ready: "[data-list-ready]" },
  "nav-list": { from: "/inbox", link: `a[href="${P}/work-items"]`, path: `${P}/work-items`, ready: "[data-list-ready]" },
  "light-cycles": { from: `${P}/work-items`, link: `[role="main"] a[href="${P}/cycles"]`, back: `a[href="${P}/work-items"]`, backReady: "[data-list-ready]", path: `${P}/cycles`, ready: `[role="main"] a[href^="${P}/cycles/"]` },
  "light-inbox": { from: "/", link: `a[href="/inbox"]`, path: "/inbox", ready: `[role="main"] li`, readyPath: "/inbox" },
  "light-analytics": { from: "/", link: `a[href="/analytics"]`, path: "/analytics", ready: `[role="main"] h2` },
};
const sc = SC[scenario];
if (!sc) throw new Error("scenario " + scenario);
const isNav = !!sc.from;
const withHook = mode === "react";
const tracePath = (i) => `${RES}/profile-${tag}.s${i}.trace.json`;
const cpuPath = (i) => `${RES}/profile-${tag}.s${i}.cpuprofile`;

const browser = await chromium.launch();
const census = () => {
  const c = (s) => document.querySelectorAll(s).length;
  const rows = c(".tessera-wi-row"), tr = c("tbody tr, [role=row]");
  return { el: document.getElementsByTagName("*").length, rows, tableRows: tr, listbox: c('[role="listbox"]'), tooltip: c('[role="tooltip"]'), popover: c("[popover]"), dialog: c("dialog"), menu: c('[role="menu"]'), combobox: c('[role="combobox"]'), button: c("button"), svg: c("svg"), cssRulesAfter: null };
};
const METRICS = ["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount", "JSHeapUsedSize", "Nodes"];
async function metrics(cdp) { const { metrics } = await cdp.send("Performance.getMetrics"); const o = {}; for (const m of metrics) if (METRICS.includes(m.name)) o[m.name] = m.value; return o; }
const delta = (a, b) => Object.fromEntries(METRICS.map((k) => [k, k.endsWith("Duration") ? Math.round((b[k] - a[k]) * 1000) : b[k] - a[k]]));

function analyzeTrace(events, t0us, t1us) {
  // main thread = the renderer thread with the most RunTask time
  const byTid = new Map();
  for (const e of events) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
  // CrRendererMain thread name lookup
  const names = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
  const mains = [...byTid.keys()].filter((k) => names.get(k) === "CrRendererMain");
  const main = mains.sort((a, b) => byTid.get(b) - byTid.get(a))[0] ?? [...byTid.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ev = events.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === main && e.dur != null && e.ts >= t0us - 1 && e.ts <= t1us).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // self times with a stack
  const GROUP = (nm) => {
    if (["EvaluateScript", "v8.evaluateModule"].includes(nm)) return "evaluate-script";
    if (["v8.compile", "V8.CompileCode", "v8.compileModule", "V8.ScriptCompiler", "V8.CompileLazy"].includes(nm) || /^v8\.(compile|parse)/i.test(nm) || nm === "v8.produceCache" || nm === "v8.deserializeOnBackground") return "compile";
    if (["FunctionCall", "v8.callFunction", "EventDispatch", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "V8.RunMicrotasks", "FireIdleCallback", "HandlePostMessage", "v8.run", "V8.Execute", "ProfileCall"].includes(nm)) return "script-call";
    if (["UpdateLayoutTree", "RecalculateStyles", "ScheduleStyleRecalculation", "InvalidateLayout"].includes(nm)) return "style";
    if (["Layout", "UpdateLayerTree", "IntersectionObserverController::computeIntersections"].includes(nm)) return "layout";
    if (["Paint", "PrePaint", "Layerize", "UpdateLayer", "Commit", "CompositeLayers", "RasterTask", "ImageDecodeTask"].includes(nm)) return "paint-commit";
    if (["ParseHTML", "HTMLDocumentParser::processParsedChunkFromBackgroundThread", "ParseAuthorStyleSheet"].includes(nm) || /Parse/.test(nm)) return "parse";
    if (/GC|V8\.GC|MajorGC|MinorGC/.test(nm)) return "gc";
    if (nm === "RunTask") return "task-self";
    return "other:" + nm;
  };
  const stack = []; const self = []; // [{e,self}]
  const SCRIPT = new Set(["EvaluateScript", "FunctionCall", "v8.callFunction", "EventDispatch", "TimerFire", "FireAnimationFrame", "RunMicrotasks", "V8.RunMicrotasks", "FireIdleCallback", "HandlePostMessage", "v8.run", "V8.Execute", "v8.evaluateModule"]);
  const forced = { style: 0, layout: 0, styleEvents: 0, layoutEvents: 0, styleElements: 0, forcedStyleElements: 0, sites: {} };
  for (const e of ev) {
    while (stack.length && stack.at(-1).end <= e.ts) stack.pop();
    const rec = { e, self: e.dur, end: e.ts + e.dur };
    if (stack.length) stack.at(-1).self -= e.dur;
    stack.push(rec); self.push(rec);
    if (e.name === "UpdateLayoutTree" || e.name === "Layout") {
      const inScript = stack.slice(0, -1).some((r) => SCRIPT.has(r.e.name));
      const k = e.name === "Layout" ? "layout" : "style";
      forced[k + "Events"]++;
      if (k === "style") { const ec = e.args?.elementCount ?? 0; forced.styleElements += ec; if (inScript) forced.forcedStyleElements += ec; }
      rec.forced = inScript;
      if (inScript) {
        forced[k] += e.dur / 1000;
        const st = e.args?.beginData?.stackTrace ?? e.args?.data?.stackTrace;
        if (st && st.length) { const f = st[0]; const key = `${k}: ${f.functionName || "(anon)"} @ ${String(f.url || "").split("/").pop().slice(0, 50)}:${f.lineNumber}`; forced.sites[key] = (forced.sites[key] ?? 0) + e.dur / 1000; }
      }
    }
  }
  forced.style = Math.round(forced.style); forced.layout = Math.round(forced.layout);
  forced.sites = Object.fromEntries(Object.entries(forced.sites).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v)]));
  const tasks = self.filter((r) => r.e.name === "RunTask").sort((a, b) => b.e.dur - a.e.dur);
  const sumIn = (lo, hi) => { const o = {}; for (const r of self) { if (r.e.ts < lo || r.e.ts >= hi || r.e.name === "RunTask") continue; const g = GROUP(r.e.name); o[g] = (o[g] ?? 0) + Math.max(0, r.self) / 1000; } for (const k of Object.keys(o)) o[k] = Math.round(o[k]); return o; };
  const sumNames = (lo, hi) => { const o = {}; for (const r of self) { if (r.e.ts < lo || r.e.ts >= hi || r.e.name === "RunTask") continue; o[r.e.name] = (o[r.e.name] ?? 0) + Math.max(0, r.self) / 1000; } return Object.fromEntries(Object.entries(o).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, Math.round(v)])); };
  const forcedIn = (lo, hi) => { let st = 0, ly = 0, n = 0, ne = 0, nf = 0; for (const r of self) { if (r.e.ts < lo || r.e.ts >= hi) continue; if (r.e.name === "UpdateLayoutTree") { n++; ne += r.e.args?.elementCount ?? 0; if (r.forced) { st += r.e.dur / 1000; nf++; } } if (r.e.name === "Layout" && r.forced) ly += r.e.dur / 1000; } return { forcedStyleMs: Math.round(st), forcedLayoutMs: Math.round(ly), updateLayoutTreeEvents: n, forcedUpdateLayoutTreeEvents: nf, styleElements: ne }; };
  const top = tasks.slice(0, 5).map((t) => ({ startMs: Math.round((t.e.ts - t0us) / 1000), durMs: Math.round(t.e.dur / 1000), groups: sumIn(t.e.ts, t.e.ts + t.e.dur), names: sumNames(t.e.ts, t.e.ts + t.e.dur), ...forcedIn(t.e.ts, t.e.ts + t.e.dur) }));
  const all = tasks.reduce((a, t) => a + t.e.dur, 0) / 1000;
  return { windowMs: Math.round((t1us - t0us) / 1000), forced, taskTotalMs: Math.round(all), tasksOver50: tasks.filter((t) => t.e.dur > 50000).length, window: sumIn(t0us, t1us + 1), windowNames: sumNames(t0us, t1us + 1), longestTasks: top };
}

async function openDrawerIfMobile(page) {
  if (!mobile) return;
  const btn = page.getByRole("button", { name: /navigation|menu|sidebar/i }).first();
  if (await btn.count()) await btn.click().catch(() => {});
  await page.waitForTimeout(600);
}

async function sample(i) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, isMobile: false });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const net = []; let netOn = false;
  if (isNav) {
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (e) => { if (!netOn) return; const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v])); net.push({ id: e.requestId, url: e.request.url.replace(/^http:\/\/127.0.0.1:\d+/, "").slice(0, 100), type: e.type, rsc: "rsc" in h, prefetch: "next-router-prefetch" in h || "next-router-segment-prefetch" in h, ts: e.timestamp }); });
    cdp.on("Network.loadingFinished", (e) => { const r = net.find((x) => x.id === e.requestId); if (r) { r.end = e.timestamp; r.enc = e.encodedDataLength; } });
    cdp.on("Network.responseReceived", (e) => { const r = net.find((x) => x.id === e.requestId); if (r) { r.resp = e.timestamp; r.cached = !!(e.response.fromDiskCache || e.response.fromPrefetchCache); } });
  }
  await page.addInitScript(INIT, { readySel: sc.ready, withHook, readyText: sc.readyText, readyPath: sc.readyPath });
  if (process.env.PATCH === "throttle") {
    // COUNTERFACTUAL (measurement only, prof build keeps function names): React 19.3's Suspense reveal throttle (FALLBACK_THROTTLE_MS = 300,
    // react-dom-client.development.js:30031) schedules the delayed commit with a setTimeout of up to 300 ms from inside completeRootWhenReady/
    // performWorkOnRoot; make that one timer fire at once. Nothing else changes.
    await page.addInitScript(() => {
      const orig = window.setTimeout; window.__throttleCut = 0;
      window.setTimeout = function (fn, ms, ...rest) { if (typeof ms === "number" && ms > 20 && ms <= 300) { const st = new Error().stack || ""; if (/completeRootWhenReady|commitRootWhenReady|performWorkOnRoot/.test(st)) { window.__throttleCut++; ms = 0; } } return orig.call(this, fn, ms, ...rest); };
    });
  }
  if (process.env.PATCH === "rpwc") {
    // COUNTERFACTUAL (measurement only, prof build keeps function names): the two getComputedStyle reads of Astryx useLayer's
    // readPortalWritingContext return a constant instead of forcing a style recalculation; nothing else changes.
    await page.addInitScript(() => {
      const orig = window.getComputedStyle; const STUB = { direction: "ltr", writingMode: "horizontal-tb" }; window.__rpwcStubbed = 0; let skipNext = false;
      window.getComputedStyle = function (el, p) { if (skipNext) { skipNext = false; return STUB; } if (el && el.tagName === "TEMPLATE") { skipNext = true; window.__rpwcStubbed++; return STUB; } return orig.apply(this, arguments); };
    });
  }
  if (cpuRate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  const url = BASE + (isNav ? sc.from : sc.path);
  // warm pass (decision 115: a user who reopens a view has the chunks cached)
  await page.goto(url, { waitUntil: "load", timeout: 240000 });
  if (isNav && sc.from === "/") await page.waitForSelector('[role="main"] h4', { timeout: 120000 });
  else if (isNav) await page.waitForFunction(() => document.querySelector('[role="main"]') && !document.querySelector('[role="main"] .astryx-skeleton'), null, { timeout: 120000 });
  else await page.waitForFunction(() => window.__perf.hydrated !== null, null, { timeout: 240000 });
  await page.evaluate(() => window.__settle(1000, 120000));
  if (isNav && process.env.REVISIT) { // visit once, go back Home, so the measured click is a revisit (chunks and prefetch cache warm in this session)
    await openDrawerIfMobile(page);
    await page.evaluate((s) => window.__rearm(s), sc.ready);
    await page.locator(sc.link).filter({ visible: true }).first().click();
    await page.waitForFunction(() => window.__perf.ready !== null, null, { timeout: 120000 });
    await page.evaluate(() => window.__settle(1000, 120000));
    await openDrawerIfMobile(page);
    await page.locator(sc.back ?? 'a[href="/"]').filter({ visible: true }).first().click();
    await page.waitForSelector(sc.backReady ?? '[role="main"] h4', { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.__settle(1000, 120000));
  }
  const l0 = load();
  let m0, t0Ms;
  if (mode === "cpu") { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 250 }); }
  if (mode === "trace") await browser.startTracing(page, { path: tracePath(i), categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "loading", "toplevel", ...(process.env.TRACE_STACK ? ["disabled-by-default-devtools.timeline.stack"] : [])] });
  let hookReset = false;
  if (isNav) {
    await page.evaluate(() => { window.__perf.lt.length = 0; if (window.__rp) { window.__rp.commits.length = 0; window.__rp.byName = {}; window.__rp.hookMs = 0; } });
    await openDrawerIfMobile(page);
    const link = page.locator(sc.link).filter({ visible: true }).first();
    await link.waitFor({ state: "visible", timeout: 30000 });
    await page.evaluate((s) => { window.__perf.lt.length = 0; window.__rearm(s); }, sc.ready);
    m0 = await metrics(cdp);
    if (mode === "cpu") await cdp.send("Profiler.start");
    t0Ms = await page.evaluate(() => performance.now());
    netOn = true; var clickTs = null;
    await link.click();
  } else {
    m0 = await metrics(cdp);
    if (mode === "cpu") await cdp.send("Profiler.start");
    await page.goto(url, { waitUntil: "commit", timeout: 240000 });
  }
  await page.waitForFunction(() => window.__perf.ready !== null, null, { timeout: 240000, polling: 20 });
  if (!isNav) await page.waitForFunction(() => window.__perf.hydrated !== null, null, { timeout: 240000, polling: 20 }).catch(() => {});
  await page.evaluate(() => window.__settle(700, 120000));
  const m1 = await metrics(cdp);
  let profile = null;
  if (mode === "cpu") profile = (await cdp.send("Profiler.stop")).profile;
  if (mode === "trace") await browser.stopTracing();
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const p = window.__perf;
    return { ready: Math.round(p.ready - (p.armedAt ?? 0)), readyAbs: Math.round(p.ready), hydrated: p.hydrated == null ? null : Math.round(p.hydrated - (p.armedAt ?? 0)), fcp: p.fcp && Math.round(p.fcp), lcp: p.lcp && Math.round(p.lcp), lt: p.lt, ttfb: Math.round(nav.responseStart), respEnd: Math.round(nav.responseEnd), domInteractive: Math.round(nav.domInteractive), loadEvt: Math.round(nav.loadEventEnd) };
  });
  const cen = await page.evaluate(census);
  let netSum = null;
  if (isNav) {
    const t0 = Math.min(...net.map((x) => x.ts));
    const rscReq = net.filter((x) => x.rsc && !x.prefetch && x.end);
    const scripts = net.filter((x) => x.type === "Script" && x.end);
    netSum = { requests: net.length, rscNonPrefetch: rscReq.map((x) => ({ url: x.url.slice(0, 70), waitMs: Math.round((x.resp - x.ts) * 1000), totalMs: Math.round((x.end - x.ts) * 1000), startAtMs: Math.round((x.ts - t0) * 1000), bytes: x.enc })), scripts: scripts.length, scriptBytes: scripts.reduce((a, x) => a + (x.enc ?? 0), 0), scriptsFromCache: scripts.filter((x) => x.cached).length, scriptSpanMs: scripts.length ? Math.round((Math.max(...scripts.map((x) => x.end)) - Math.min(...scripts.map((x) => x.ts))) * 1000) : 0, scriptStartAtMs: scripts.length ? Math.round((Math.min(...scripts.map((x) => x.ts)) - t0) * 1000) : null, scriptEndAtMs: scripts.length ? Math.round((Math.max(...scripts.map((x) => x.end)) - t0) * 1000) : null, other: net.filter((x) => !x.rsc && x.type !== "Script").map((x) => x.type + " " + x.url.slice(0, 50)).slice(0, 8) };
  }
  const row = { i, load: l0, ready: r.ready, hydrated: r.hydrated, fcp: r.fcp, lcp: r.lcp, ttfb: r.ttfb, respEnd: r.respEnd, ltCount: r.lt.length, ltMax: Math.max(0, ...r.lt.map((x) => x[1])), ltSum: r.lt.reduce((a, x) => a + x[1], 0), lt: r.lt, cdp: isNav ? delta(m0, m1) : Object.fromEntries(METRICS.map((k) => [k, k.endsWith("Duration") ? Math.round(m1[k] * 1000) : m1[k]])), census: cen };
  if (isNav) { row.clickToReadyAbs = r.ready; row.net = netSum; }
  if (mode === "react") {
    const rp = await page.evaluate(() => { const R = window.__rp; if (!R) return null; return { hookMs: Math.round(R.hookMs), nCommits: R.commits.length, commits: R.commits.map(({ per, ...c }) => c), byName: R.byName, err: R.err, topCommit: R.commits.slice().sort((a, b) => b.dur - a.dur)[0], hasDur: R.commits.some((c) => c.dur > 0) }; });
    row.react = rp;
  }
  if (mode === "trace") {
    const tr = JSON.parse(fs.readFileSync(tracePath(i), "utf8")); const events = tr.traceEvents ?? tr;
    const t = events.filter((e) => e.ph === "X" && e.name === "RunTask");
    // window = from the first main RunTask after tracing started to the last
    const ts = events.filter((e) => e.ts > 0).map((e) => e.ts); const lo = Math.min(...ts), hi = Math.max(...ts);
    row.trace = analyzeTrace(events, lo, hi);
    if (i > 0 && !process.env.KEEP_TRACES) fs.rmSync(tracePath(i), { force: true });
  }
  if (mode === "cpu") { fs.writeFileSync(cpuPath(i), JSON.stringify(profile)); row.cpuprofile = cpuPath(i); row.t0Ms = t0Ms ?? 0; }
  await ctx.close();
  return row;
}

const out = { patch: process.env.PATCH ?? null, mode, variant, set, vp, viewport: view, cpuRate, scenario, n, tag, rows: [], loadStart: load(), startedAt: new Date().toISOString() };
for (let i = 0; i < n; i++) {
  try { const r = await sample(i); out.rows.push(r); process.stdout.write(`s${i} ready=${r.ready} hyd=${r.hydrated} ltMax=${r.ltMax} load=${r.load}\n`); }
  catch (e) { out.rows.push({ i, error: String(e).slice(0, 300) }); process.stdout.write(`s${i} ERROR ${String(e).slice(0, 200)}\n`); }
}
out.loadEnd = load();
const ok = out.rows.filter((r) => !r.error);
const pick = (f) => ok.map(f);
out.summary = { n: ok.length, ready: { median: median(pick((r) => r.ready)), p95: pct(pick((r) => r.ready), 95), min: Math.min(...pick((r) => r.ready)), max: Math.max(...pick((r) => r.ready)) }, hydrated: median(pick((r) => r.hydrated)), fcp: median(pick((r) => r.fcp)), ltMax: median(pick((r) => r.ltMax)), ltSum: median(pick((r) => r.ltSum)), cdp: Object.fromEntries(METRICS.map((k) => [k, median(pick((r) => r.cdp[k]))])), census: ok[0]?.census, load: [out.loadStart, out.loadEnd] };
fs.writeFileSync(`${RES}/profile-${tag}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary));
await browser.close();

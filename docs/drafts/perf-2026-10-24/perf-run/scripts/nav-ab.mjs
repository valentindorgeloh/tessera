// A/B of the nav sequence: A = baseline build on 3804, B = prod-blocking build (inbox + cycles pages: no page-level
// Suspense, instant = false) on 3805, both on fresh copies of the SMALL data set. Rounds interleave A,B,A,B.
// Usage: node nav-ab.mjs <none|cpu4> [rounds=5]
// c. Client navigation Home -> Projects -> Work items -> Cycles -> Inbox -> Analytics -> Home, click-to-ready per step.
// Each round: fresh context, hard load of /, wait for hydration and idle, then the sequence twice (cold client cache,
// then warm). Logs whether an RSC prefetch for the target finished before the click and how long the navigation's
// RSC request took. Usage: node nav.mjs <small|large> <none|cpu4> [rounds=5]
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, median, pct, load } from "./routes.mjs";
import { NAV_INIT } from "./nav-init.mjs";

const set = "small";
const throttle = process.argv[2] ?? "none";
const rounds = Number(process.argv[3] ?? 5);
const { project } = SETS[set];
const ARMS = { A: 3804, B: 3805 };
let base = "";
const P = `/projects/${project}`;
const OUT = new URL(`../results/nav-ab-small-${throttle}.json`, import.meta.url).pathname;
const SETTLE_MAX = throttle === "cpu4" ? 120_000 : 60_000;

const STEPS = [
  { name: "home->projects", click: 'nav a[href="/projects"]', target: "/projects", ready: { path: "/projects", sel: `[role="main"] a[href="${P}/work-items"]`, noSkeleton: true } },
  { name: "projects->work-items", click: `[role="main"] a[href="${P}/work-items"]`, target: `${P}/work-items`, ready: { path: `${P}/work-items`, sel: "[data-list-ready]", noSkeleton: true } },
  { name: "work-items->cycles", click: `[role="main"] a[href="${P}/cycles"]`, target: `${P}/cycles`, ready: { path: `${P}/cycles`, sel: `[role="main"] a[href^="${P}/cycles/"]`, noSkeleton: true } },
  { name: "cycles->inbox", click: 'nav a[href="/inbox"]', target: "/inbox", ready: { path: "/inbox", sel: '[role="main"] h2', text: "Select a notification", noSkeleton: true } },
  { name: "inbox->analytics", click: 'nav a[href="/analytics"]', target: "/analytics", ready: { path: "/analytics*", sel: '[role="main"] h2', text: "Work items by state group", noSkeleton: true } },
  { name: "analytics->home", click: 'nav a[href="/"]', clickText: "Home", target: "/", ready: { path: "/", sel: '[role="main"] h4', text: "Since you were last here", noSkeleton: true } },
];

const browser = await chromium.launch();

async function round() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (throttle === "cpu4") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (!("rsc" in h) && !("next-router-prefetch" in h) && !e.request.url.includes("_rsc=")) return;
    const u = new URL(e.request.url);
    reqs.set(e.requestId, {
      path: u.pathname,
      prefetch: "next-router-prefetch" in h || "next-router-segment-prefetch" in h,
      segment: h["next-router-segment-prefetch"] ?? null,
      sentAt: Date.now(),
      ts: e.timestamp,
      doneAt: null,
      ms: null,
      bytes: null,
      status: null,
    });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.status = e.response.status;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.doneAt = Date.now();
      r.ms = Math.round((e.timestamp - r.ts) * 1000);
      r.bytes = e.encodedDataLength;
    }
  });
  await page.addInitScript(NAV_INIT);
  await page.goto(base + "/", { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector('[role="main"] h4', { timeout: 60_000 });
  await page.evaluate((max) => window.__settle(1500, max), SETTLE_MAX);
  const out = [];
  for (const pass of ["cold", "warm"]) {
    for (const step of STEPS) {
      await page.waitForTimeout(1500); // viewport prefetches of the newly shown links
      let loc = page.locator(step.click).filter({ visible: true });
      if (step.clickText) loc = loc.filter({ hasText: step.clickText });
      loc = loc.first();
      await loc.waitFor({ state: "visible", timeout: 30_000 });
      await page.evaluate((spec) => window.__arm(spec), step.ready);
      const clickAt = Date.now();
      await loc.click({ timeout: SETTLE_MAX });
      const ok = await page.waitForFunction(() => window.__nav.dt !== null, null, { timeout: SETTLE_MAX, polling: 50 }).then(() => true, () => false);
      const nav = await page.evaluate(() => window.__nav);
      const busyAfter = await page.evaluate((max) => window.__settle(1000, max), SETTLE_MAX);
      const targetReqs = [...reqs.values()].filter((r) => r.path === step.target || (step.target === "/analytics" && r.path.startsWith("/analytics")));
      const prefetchedBefore = targetReqs.filter((r) => r.prefetch && r.doneAt !== null && r.doneAt <= clickAt);
      const after = targetReqs.filter((r) => !r.prefetch && r.sentAt >= clickAt - 5);
      const prefetchAfter = targetReqs.filter((r) => r.prefetch && r.sentAt >= clickAt - 5);
      out.push({
        pass,
        step: step.name,
        ok,
        clickToReady: nav.dt === null ? null : Math.round(nav.dt),
        busyAfterReady: busyAfter,
        longTasksToReady: nav.lt ?? null,
        skeletonAt: nav.skel ?? null,
        prefetched: prefetchedBefore.length > 0,
        prefetchReqs: prefetchedBefore.map((r) => ({ seg: r.segment, ms: r.ms, kb: r.bytes && Math.round(r.bytes / 1024) })),
        navRsc: after.map((r) => ({ ms: r.ms, kb: r.bytes && Math.round(r.bytes / 1024), status: r.status })),
        prefetchAfterClick: prefetchAfter.length,
      });
    }
  }
  await context.close();
  return out;
}

const result = { set, throttle, rounds, arms: ARMS, startedAt: new Date().toISOString(), loadBefore: load(), runs: { A: [], B: [] }, loads: [] };
for (let i = 0; i < rounds; i++) {
  for (const arm of i % 2 ? ["B", "A"] : ["A", "B"]) {
    base = `http://127.0.0.1:${ARMS[arm]}`;
    result.runs[arm].push(await round());
  }
  result.loads.push(load());
  process.stdout.write(`round ${i + 1} load ${load()}\n`);
}
result.loadAfter = load();
result.summary = {};
for (const arm of ["A", "B"])
for (const pass of ["cold", "warm"]) {
  for (const step of STEPS) {
    const rows = result.runs[arm].map((r) => r.find((x) => x.pass === pass && x.step === step.name));
    const navMs = rows.flatMap((r) => r.navRsc.map((x) => x.ms)).filter((x) => x !== null);
    result.summary[`${arm} ${pass} ${step.name}`] = {
      click_to_ready: median(rows.map((r) => r.clickToReady)),
      p95: pct(rows.map((r) => r.clickToReady), 95),
      lt_to_ready: median(rows.map((r) => r.longTasksToReady)),
      skeleton_at: median(rows.map((r) => r.skeletonAt)),
      skeleton_seen: rows.filter((r) => r.skeletonAt !== null).length,
      busy_after: median(rows.map((r) => r.busyAfterReady)),
      prefetched: `${rows.filter((r) => r.prefetched).length}/${rows.length}`,
      nav_rsc_ms: median(navMs),
      nav_rsc_kb: median(rows.flatMap((r) => r.navRsc.map((x) => x.kb))),
      nav_rsc_reqs: median(rows.map((r) => r.navRsc.length)),
      n: rows.filter((r) => r.ok).length,
    };
  }
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`load before ${result.loadBefore} after ${result.loadAfter}`);
console.table(result.summary);
await browser.close();

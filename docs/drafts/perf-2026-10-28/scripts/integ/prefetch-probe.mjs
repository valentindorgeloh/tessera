// Probe (perf-research/next): what the production App Router prefetches for Tessera's sidebar links under
// partialPrefetching, what a click then fetches, and whether revisits reuse the client cache.
// Usage: node prefetch-probe.mjs <port> <projectId> <outFile>
// Indicative only: one run on a shared, loaded machine.
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const port = process.argv[2] ?? "3840";
const project = process.argv[3];
const outFile = process.argv[4];
const base = `http://127.0.0.1:${port}`;
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(" ");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");

const reqs = [];
const byId = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const u = new URL(e.request.url);
  const isRsc = "rsc" in h || u.searchParams.has("_rsc");
  const isAction = "next-action" in h;
  if (!isRsc && !isAction && !u.pathname.startsWith("/api/")) return;
  const r = {
    t: Date.now(),
    method: e.request.method,
    path: u.pathname,
    prefetch: h["next-router-prefetch"] ?? null,
    segment: h["next-router-segment-prefetch"] ?? null,
    action: isAction,
    status: null,
    kb: null,
    ms: null,
    ts: e.timestamp,
  };
  byId.set(e.requestId, r);
  reqs.push(r);
});
cdp.on("Network.responseReceived", (e) => {
  const r = byId.get(e.requestId);
  if (r) r.status = e.response.status;
});
cdp.on("Network.loadingFinished", (e) => {
  const r = byId.get(e.requestId);
  if (r) {
    r.kb = +(e.encodedDataLength / 1024).toFixed(1);
    r.ms = Math.round((e.timestamp - r.ts) * 1000);
  }
});

const mark = () => reqs.length;
const since = (i) =>
  reqs.slice(i).filter((r) => !r.path.startsWith("/api/changes")).map(({ ts, t, ...rest }) => rest);

const out = { port, load_before: load(), steps: [] };

async function settle(ms) {
  await page.waitForTimeout(ms);
}

// Polls each frame from the click: URL commit, first visible skeleton in main, and readiness.
async function timedClick(locator, readyFn, label) {
  const i = mark();
  await page.evaluate(() => {
    window.__t = { t0: null, url: null, skel: null, ready: null, startPath: location.pathname };
    const W = window;
    document.addEventListener("pointerdown", (ev) => (W.__t.t0 = ev.timeStamp), { capture: true, once: true });
  });
  await page.evaluate((readySrc) => {
    const ready = new Function(`return (${readySrc})()`);
    const W = window;
    const vis = (e) => e && e.checkVisibility && e.checkVisibility();
    const tick = () => {
      const now = performance.now();
      if (W.__t.t0 !== null) {
        if (W.__t.url === null && location.pathname !== W.__t.startPath) W.__t.url = Math.round(now - W.__t.t0);
        const main = document.querySelector('[role="main"]');
        if (W.__t.skel === null && main && [...main.querySelectorAll(".astryx-skeleton")].some(vis)) W.__t.skel = Math.round(now - W.__t.t0);
        if (ready()) {
          W.__t.ready = Math.round(now - W.__t.t0);
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, readyFn.toString());
  await locator.click();
  await page.waitForFunction(() => window.__t.ready !== null, null, { timeout: 30000, polling: 50 });
  const t = await page.evaluate(() => window.__t);
  await settle(1200);
  out.steps.push({ step: label, url_ms: t.url, skeleton_ms: t.skel, ready_ms: t.ready, requests: since(i) });
}

// 1. Hard load /inbox and let the viewport prefetches run.
let i = mark();
await page.goto(base + "/inbox", { waitUntil: "load" });
await page.waitForSelector('[role="main"] h2');
await settle(3000);
out.steps.push({ step: "load /inbox + 3 s idle (viewport prefetches)", requests: since(i) });

// 2. Hover the Analytics link.
i = mark();
await page.locator(`nav a[href="${process.env.ANALYTICS_HREF ?? "/analytics"}"]`).first().hover();
await settle(1500);
out.steps.push({ step: "hover nav Analytics", requests: since(i) });

// 3. Click Analytics (the link points at /analytics, which redirects to /analytics/overview in the page).
await timedClick(
  page.locator(`nav a[href="${process.env.ANALYTICS_HREF ?? "/analytics"}"]`).first(),
  () => location.pathname === "/analytics/overview" && [...document.querySelectorAll('[role="main"] h2')].some((e) => e.textContent.includes("Work items by state group")),
  "click nav Analytics (/analytics -> redirect)",
);

// 4. Link back to Inbox (visited 1 navigation ago; still in the Activity-preserved set).
await timedClick(
  page.locator('nav a[href="/inbox"]').first(),
  () => location.pathname === "/inbox" && [...document.querySelectorAll('[role="main"] h2')].some((e) => e.textContent.includes("Select a notification")),
  "click nav Inbox (revisit via Link)",
);

// 5. Browser back to /analytics/overview (history traversal).
i = mark();
const tb = Date.now();
await page.goBack();
await page.waitForFunction(() => location.pathname === "/analytics/overview" && [...document.querySelectorAll('[role="main"] h2')].some((e) => e.textContent.includes("Work items by state group") && e.checkVisibility()));
out.steps.push({ step: "browser back to /analytics/overview", wall_ms: Date.now() - tb, requests: since(i) });
await settle(1200);

// 6. Into a project from outside it (project layout + page shell).
if (project) {
  const link = page.locator(`nav a[href="/projects/${project}/work-items"]`).first();
  if (await link.count()) {
    await timedClick(
      link,
      () => !!document.querySelector("[data-list-ready]") && ![...document.querySelectorAll('[role="main"] .astryx-skeleton')].some((e) => e.checkVisibility()),
      "click nav project Work items (from /analytics/overview)",
    );
    // 7. Sibling inside the project (shared project layout).
    const cyc = page.locator(`a[href="/projects/${project}/cycles"]`).filter({ visible: true }).first();
    if (await cyc.count()) {
      await timedClick(cyc, () => location.pathname.endsWith("/cycles") && ![...document.querySelectorAll('[role="main"] .astryx-skeleton')].some((e) => e.checkVisibility()), "click project tab Cycles (sibling in project layout)");
    }
  } else {
    out.steps.push({ step: "project work-items link not in nav", requests: [] });
  }
}

// 8. Idle 9 s to see the poller and any re-prefetching.
i = mark();
await settle(9000);
out.steps.push({ step: "9 s idle on page", requests: reqs.slice(i).map(({ ts, t, ...rest }) => rest) });

out.load_after = load();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
for (const s of out.steps) {
  console.log(`\n## ${s.step}${s.ready_ms !== undefined ? `  url ${s.url_ms} ms, skeleton ${s.skeleton_ms} ms, ready ${s.ready_ms} ms` : ""}${s.wall_ms !== undefined ? `  wall ${s.wall_ms} ms` : ""}`);
  for (const r of s.requests) console.log(`  ${r.method} ${r.path} pf=${r.prefetch} seg=${r.segment} act=${r.action} ${r.status} ${r.kb}kB ${r.ms}ms`);
}
console.log(`load ${out.load_before} -> ${out.load_after}`);
await browser.close();

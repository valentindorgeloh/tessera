// React-runtime probe helpers (perf-research/react). Playwright + CDP against a production `next start`.
// - installs a fake React DevTools hook BEFORE React loads: counts commits and the components that performed work
//   (fiber.flags & PerformedWork(1)), walking only subtrees whose subtreeFlags carry the bit.
// - observes longtask + event timing (INP-like) entries.
import { execSync } from "node:child_process";
import { chromium } from "playwright";

export const load = () => execSync("uptime").toString().trim().replace(/.*load averages?: /, "");

export const INIT = () => {
  const W = window;
  const S = (W.__rc = { commits: 0, worked: 0, byType: new Map(), collecting: !!W.__RC_START, log: [] });
  const typeName = (f) => {
    const t = f.type;
    if (!t) return "?";
    if (typeof t === "function") return t.displayName || t.name || "anon";
    if (typeof t === "object") {
      const inner = t.render || t.type;
      return (t.displayName || (inner && (inner.displayName || inner.name)) || "obj") + (t.$$typeof && String(t.$$typeof).includes("memo") ? "(memo)" : "");
    }
    return String(t);
  };
  const countWork = (root) => {
    let n = 0;
    const stack = [root.current];
    const byType = new Map();
    while (stack.length) {
      const f = stack.pop();
      if (f.flags & 1) {
        n++;
        const k = typeName(f);
        byType.set(k, (byType.get(k) || 0) + 1);
      }
      if (f.child && (f.subtreeFlags & 1 || f.tag === 3)) {
        let c = f.child;
        while (c) {
          stack.push(c);
          c = c.sibling;
        }
      }
    }
    return [n, byType];
  };
  const hook = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(internals) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, internals);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      S.commits++;
      if (!S.collecting) return;
      const t = performance.now();
      const [n, byType] = countWork(root);
      S.worked += n;
      for (const [k, v] of byType) S.byType.set(k, (S.byType.get(k) || 0) + v);
      S.log.push([Math.round(t), n, n > 300 ? [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14) : undefined]);
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    setStrictMode() {},
    checkDCE() {},
  };
  Object.defineProperty(W, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: true });

  // Long tasks + event timing
  W.__lt = [];
  W.__ev = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) W.__lt.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) W.__ev.push({ type: e.name, start: e.startTime, dur: e.duration, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart, present: e.startTime + e.duration - e.processingEnd });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}

  const visible = (e) => e && e.checkVisibility && e.checkVisibility();
  W.__visible = visible;
  // __arm(sel[,opts]): t0 = next input (capture), poll each frame until a visible element matches sel (text optional).
  W.__armed = null;
  W.__arm = (spec) => {
    const a = (W.__armed = { t0: null, ready: null, dt: null, spec });
    S.commits0 = S.commits;
    S.worked = 0;
    S.byType = new Map();
    S.log = [];
    S.collecting = true;
    const lt0 = W.__lt.length;
    const ev0 = W.__ev.length;
    a.lt0 = lt0;
    a.ev0 = ev0;
    const onInput = (ev) => {
      if (a.t0 === null) a.t0 = ev.timeStamp;
    };
    document.addEventListener("pointerdown", onInput, { capture: true, once: true });
    document.addEventListener("keydown", onInput, { capture: true, once: true });
    const matches = () => {
      const els = [...document.querySelectorAll(spec.sel)].filter(visible);
      const el = spec.text ? els.find((e) => e.textContent.includes(spec.text)) : els[0];
      if (!el) return false;
      if (spec.gone && [...document.querySelectorAll(spec.gone)].some(visible)) return false;
      return true;
    };
    const tick = () => {
      if (a.t0 !== null && matches()) {
        // two rAFs after the match: the frame that paints it
        requestAnimationFrame(() => {
          a.ready = performance.now();
          a.dt = a.ready - a.t0;
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  W.__markT0 = () => {
    if (W.__armed && W.__armed.t0 === null) W.__armed.t0 = performance.now();
  };
  // Resolves when no long task / commit has happened for `quiet` ms.
  W.__settle = (quiet = 800, max = 40000) =>
    new Promise((resolve) => {
      const start = performance.now();
      let lastCommits = S.commits;
      let lastChange = performance.now();
      const check = () => {
        const now = performance.now();
        const lt = W.__lt.length ? W.__lt[W.__lt.length - 1] : null;
        const ltEnd = lt ? lt[0] + lt[1] : 0;
        if (S.commits !== lastCommits) {
          lastCommits = S.commits;
          lastChange = now;
        }
        if (now - Math.max(lastChange, ltEnd) >= quiet || now - start > max) resolve(now - start);
        else setTimeout(check, 100);
      };
      check();
    });
  W.__collect = () => {
    const a = W.__armed;
    S.collecting = false;
    const lts = W.__lt.slice(a.lt0 || 0).filter(([s]) => a.t0 === null || s + 5000 > a.t0);
    const end = a.ready ?? performance.now();
    const within = W.__lt.filter(([s, d]) => a.t0 !== null && s + d > a.t0 && s < end + 100);
    return {
      dt: a.dt === null ? null : Math.round(a.dt),
      commits: S.commits - (S.commits0 ?? 0),
      worked: S.worked,
      topTypes: [...S.byType.entries()].sort((x, y) => y[1] - x[1]).slice(0, 60),
      longTasks: within.map(([s, d]) => Math.round(d)),
      ltTotal: Math.round(within.reduce((acc, [, d]) => acc + d, 0)),
      events: W.__ev.slice(a.ev0 || 0).map((e) => ({ ...e, start: Math.round(e.start), dur: Math.round(e.dur), delay: Math.round(e.delay), proc: Math.round(e.proc), present: Math.round(e.present) })),
      log: S.log.slice(0, 30),
    };
  };
};

export async function newPage({ cpu = 1, width = 1440, height = 900, mobile = false, fromStart = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: mobile, isMobile: mobile });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (cpu !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (fromStart) await page.addInitScript(() => { window.__RC_START = true; });
  await page.addInitScript(INIT);
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 300)));
  return { browser, context, page, cdp };
}

export const median = (xs) => {
  const a = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export async function gotoReady(page, url, readySel = "[data-list-ready]") {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySel, { state: "attached", timeout: 120000 });
  // wait for hydration: React fiber on the ready element
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  }, readySel, { timeout: 120000 });
  return page.evaluate(() => window.__settle(1000, 90000));
}

export const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");

// Renderer CPU seconds (cumulative) through a browser-level CDP session: independent of machine load, unlike wall time.
export async function cpuProbe(browser) {
  const s = await browser.newBrowserCDPSession();
  const read = async () => {
    const { processInfo } = await s.send("SystemInfo.getProcessInfo");
    return processInfo.filter((p) => p.type === "renderer").reduce((a, p) => a + p.cpuTime, 0) * 1000;
  };
  return { read };
}

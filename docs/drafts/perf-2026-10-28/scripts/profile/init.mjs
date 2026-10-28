// In-page instrumentation. INIT(readySel, withHook): observers + ready poll (+ React DevTools hook that sums per-component self time on a profiling build).
export const INIT = ({ readySel, withHook, readyText, readyPath }) => {
  const P = (window.__perf = { readyText, readyPath, lt: [], fcp: null, lcp: null, ready: null, hydrated: null, nodesAtReady: null, readySel, shellReady: null });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name === "first-contentful-paint") P.fcp = e.startTime; } }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  const vis = (e) => e && e.checkVisibility && e.checkVisibility();
  const hasFiber = (el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  let el = null;
  const tick = () => {
    if (P.ready === null) {
      el = (P.readyPath && !location.pathname.startsWith(P.readyPath)) ? null : [...document.querySelectorAll(P.readySel || "[data-list-ready]")].find((e) => vis(e) && (!P.readyText || (e.innerText || "").includes(P.readyText))) ?? null;
      if (el) { P.ready = performance.now(); P.nodesAtReady = document.getElementsByTagName("*").length; }
    }
    if (P.ready !== null && P.hydrated === null && el && hasFiber(el)) P.hydrated = performance.now();
    if (P.hydrated === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__rearm = (sel) => { P.readySel = sel || P.readySel; P.ready = null; P.hydrated = null; P.armedAt = performance.now(); el = null; requestAnimationFrame(tick); };
  // idle detector: resolves after `quiet` ms with no frame delayed > 100 ms
  window.__settle = (quiet = 800, max = 60000) => new Promise((res) => {
    let last = performance.now(), q = 0; const t0 = last;
    const ping = () => { const n = performance.now(); q = n - last < 100 ? q + (n - last) : 0; last = n; if (q >= quiet || n - t0 > max) res(Math.round(n - t0)); else setTimeout(ping, 50); };
    setTimeout(ping, 50);
  });
  if (!withHook) return;
  // --- React DevTools hook: per-commit, per-component self time (needs the profiling build for actualDuration)
  const R = (window.__rp = { commits: [], byName: {}, on: true, hookMs: 0 });
  const nameOf = (f) => {
    const t = f.type; if (!t) return null;
    if (typeof t === "function") return t.displayName || t.name || "(anon)";
    if (typeof t === "object") { // memo / forwardRef
      if (t.displayName) return t.displayName;
      const inner = t.type || t.render; if (inner) return (typeof inner === "function" ? (inner.displayName || inner.name) : (inner.type?.name || inner.render?.name)) || "(anon)";
    }
    return "(anon)";
  };
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const record = (root) => {
    if (!R.on) return;
    const h0 = performance.now();
    const cur = root.current; const per = {}; let comps = 0, mounts = 0; let total = 0;
    const stack = [cur];
    while (stack.length) {
      const f = stack.pop(); const alt = f.alternate; const mounted = alt === null;
      if (!mounted && f.child === alt.child) continue;
      let childSum = 0; for (let c = f.child; c; c = c.sibling) { childSum += c.actualDuration || 0; stack.push(c); }
      if (COMPONENT_TAGS.has(f.tag) && (f.flags & 1)) {
        const nm = nameOf(f); const self = Math.max(0, (f.actualDuration || 0) - childSum);
        const o = per[nm] || (per[nm] = { n: 0, ms: 0, mount: 0 }); o.n++; o.ms += self; if (mounted) { o.mount++; mounts++; } comps++; total += self;
        const g = R.byName[nm] || (R.byName[nm] = { n: 0, ms: 0, mount: 0 }); g.n++; g.ms += self; if (mounted) g.mount++;
      }
    }
    R.commits.push({ t: Math.round(h0), dur: +(cur.actualDuration || 0).toFixed(1), comps, mounts, selfSum: +total.toFixed(1), per });
    R.hookMs += performance.now() - h0;
  };
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers, isDisabled: false, supportsFlight: true,
    inject(r) { const id = renderers.size + 1; renderers.set(id, r); return id; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(id, root) { try { record(root); } catch (e) { (R.err = R.err || []).push(String(e)); } },
    getInternalModuleRanges() { return []; }, registerInternalModuleStart() {}, registerInternalModuleStop() {},
  };
};

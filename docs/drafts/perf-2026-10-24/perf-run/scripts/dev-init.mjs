// MEASURE-DEV in-page instrumentation (passed to page.addInitScript).
// window.__p = { lt: [[start,dur]], fcp, lcp, ready, hydrated }; window.__readyEl(sel) finds the ready element:
// the visible match of sel (or visible main content) with no visible .astryx-skeleton in [role=main].
// window.__arm(spec) times the next pointerdown/keydown to the spec { path, sel, text } being met (window.__nav).
export const DEV_INIT = () => {
  const W = window;
  const P = (W.__p = { lt: [], fcp: null, lcp: null, ready: null, hydrated: null, fr: [] });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") P.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  } catch {}
  const visible = (e) => e && e.checkVisibility && e.checkVisibility();
  const noSkeleton = () => {
    const main = document.querySelector('[role="main"]');
    return !(main && [...main.querySelectorAll(".astryx-skeleton")].some(visible));
  };
  W.__readyEl = (sel, text) => {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;
    let el = null;
    if (sel) {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      el = text ? els.find((e) => e.textContent.includes(text)) : els[0];
      if (!el) return null;
    }
    if (!noSkeleton()) return null;
    if (!el) {
      if (main.innerText.trim().length === 0) return null;
      el = [...main.querySelectorAll("h1,h2,h3,h4,a,button,p")].find(visible) ?? null;
    }
    return el;
  };
  const hasFiber = (el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  W.__watchReady = (sel) => {
    let el = null;
    const tick = () => {
      if (P.ready === null) {
        el = W.__readyEl(sel);
        if (el) P.ready = performance.now();
      }
      if (P.ready !== null && P.hydrated === null && el && hasFiber(el)) P.hydrated = performance.now();
      if (P.hydrated === null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  W.__arm = (spec) => {
    W.__nav = { t0: null, ready: null, dt: null, spec };
    const onInput = (ev) => { if (W.__nav.t0 === null) W.__nav.t0 = ev.timeStamp; };
    document.addEventListener("pointerdown", onInput, { capture: true, once: true });
    document.addEventListener("keydown", onInput, { capture: true, once: true });
    const matches = () => {
      if (spec.path) {
        const p = location.pathname + location.search;
        if (spec.path.endsWith("*") ? !p.startsWith(spec.path.slice(0, -1)) : location.pathname !== spec.path) return false;
      }
      return !!W.__readyEl(spec.sel, spec.text);
    };
    const tick = () => {
      if (W.__nav.t0 !== null && matches()) {
        W.__nav.ready = performance.now();
        W.__nav.dt = W.__nav.ready - W.__nav.t0;
        const t0 = W.__nav.t0;
        W.__nav.lt = Math.round(P.lt.filter(([s, d]) => s + d > t0 && s < W.__nav.ready).reduce((a, [s, d]) => a + d - Math.max(0, t0 - s), 0));
        // RSC fetches for the navigation (resource timing, same clock as t0).
        W.__nav.rsc = performance.getEntriesByType("resource")
          .filter((e) => e.startTime >= t0 - 5 && e.initiatorType === "fetch" && !/\/_next\/|\/api\//.test(e.name))
          .map((e) => ({ url: e.name.replace(location.origin, ""), start: Math.round(e.startTime - t0), ttfb: Math.round(e.responseStart - t0), end: Math.round(e.responseEnd - t0), kb: Math.round((e.encodedBodySize || e.transferSize || 0) / 1024) }));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  W.__settle = (quiet = 1000, max = 60000) =>
    new Promise((resolve) => {
      const start = performance.now();
      const check = () => {
        const now = performance.now();
        const last = P.lt.reduce((m, [s, d]) => Math.max(m, s + d), 0);
        if (now - Math.max(last, start) >= quiet || now - start > max) resolve(Math.round(Math.max(0, last - start)));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });
};

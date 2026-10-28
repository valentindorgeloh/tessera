// In-page helpers for click-to-ready timing on client navigations and interactions.
// __arm(spec) records the next pointerdown/keydown (capture phase) as t0 and polls each frame for the spec:
// { path?: exact pathname or prefix ending in "*", sel: CSS selector, text?: substring the visible match must contain,
//   noSkeleton?: true to also require no visible .astryx-skeleton in [role=main] }.
// The result lands in window.__nav = { t0, ready, dt }.
export const NAV_INIT = () => {
  const W = window;
  W.__lt = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) W.__lt.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  const visible = (e) => e && e.checkVisibility && e.checkVisibility();
  const matches = (spec) => {
    if (spec.path) {
      const p = location.pathname + location.search;
      if (spec.path.endsWith("*") ? !p.startsWith(spec.path.slice(0, -1)) : location.pathname !== spec.path) return false;
    }
    const els = [...document.querySelectorAll(spec.sel)].filter(visible);
    const el = spec.text ? els.find((e) => e.textContent.includes(spec.text)) : els[0];
    if (!el) return false;
    if (spec.gone) {
      const g = [...document.querySelectorAll(spec.gone)].filter(visible);
      if (g.some((e) => !spec.goneText || e.textContent.includes(spec.goneText))) return false;
    }
    if (spec.noSkeleton) {
      const main = document.querySelector('[role="main"]');
      if (main && [...main.querySelectorAll(".astryx-skeleton")].some(visible)) return false;
    }
    return true;
  };
  W.__arm = (spec) => {
    W.__nav = { t0: null, ready: null, dt: null, spec };
    const onInput = (ev) => {
      if (W.__nav.t0 === null) W.__nav.t0 = ev.timeStamp;
    };
    document.addEventListener("pointerdown", onInput, { capture: true, once: true });
    document.addEventListener("keydown", onInput, { capture: true, once: true });
    const tick = () => {
      if (W.__nav.t0 !== null && W.__nav.skel === undefined) {
        const main = document.querySelector('[role="main"]');
        if (main && [...main.querySelectorAll(".astryx-skeleton")].some(visible)) W.__nav.skel = Math.round(performance.now() - W.__nav.t0);
      }
      if (W.__nav.t0 !== null && matches(spec)) {
        W.__nav.ready = performance.now();
        W.__nav.dt = W.__nav.ready - W.__nav.t0;
        const t0 = W.__nav.t0;
        W.__nav.lt = Math.round(W.__lt.filter(([s, d]) => s + d > t0 && s < W.__nav.ready).reduce((a, [s, d]) => a + d - Math.max(0, t0 - s), 0));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // Resolves once no long task has started or ended in the last `quiet` ms (or after `max` ms).
  W.__settle = (quiet = 1000, max = 60000) =>
    new Promise((resolve) => {
      const start = performance.now();
      const check = () => {
        const now = performance.now();
        const last = W.__lt.reduce((m, [s, d]) => Math.max(m, s + d), 0);
        if (now - Math.max(last, start) >= quiet || now - start > max) resolve(Math.round(Math.max(0, last - start)));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });
};

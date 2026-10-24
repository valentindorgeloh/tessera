// In-page instrumentation shared by the browser scripts: paint/LCP/long-task observers and a ready detector.
// window.__perf.ready = performance.now() when the ready selector (or, without one, visible main content with no
// visible skeleton) first shows; .hydrated when that element carries a React fiber.
export const INIT = (readySel) => {
  const P = (window.__perf = { lt: [], lcp: null, fcp: null, ready: null, hydrated: null, readySel, nodes: null });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.lt.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === "first-contentful-paint") P.fcp = e.startTime;
    }).observe({ type: "paint", buffered: true });
  } catch {}
  const visible = (e) => e && e.checkVisibility && e.checkVisibility();
  window.__perfReadyEl = (sel) => {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;
    let el = null;
    if (sel) {
      el = [...document.querySelectorAll(sel)].find(visible) ?? null;
      if (!el) return null;
    }
    if ([...main.querySelectorAll(".astryx-skeleton")].some(visible)) return null;
    if (!el) {
      if (main.innerText.trim().length === 0) return null;
      el = [...main.querySelectorAll("h1,h2,h3,a,button,p")].find(visible) ?? main;
    }
    return el;
  };
  const hasFiber = (el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  let el = null;
  const tick = () => {
    if (P.ready === null) {
      el = window.__perfReadyEl(P.readySel);
      if (el) {
        P.ready = performance.now();
        P.nodes = document.getElementsByTagName("*").length;
      }
    }
    if (P.ready !== null && P.hydrated === null && el && hasFiber(el)) P.hydrated = performance.now();
    if (P.hydrated === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

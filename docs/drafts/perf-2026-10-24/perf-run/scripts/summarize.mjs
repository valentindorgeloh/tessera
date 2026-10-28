// Collects every results JSON of the measure-prod run into one metrics list (results/metrics.json).
import fs from "node:fs";

const R = new URL("../results/", import.meta.url).pathname;
const read = (f) => (fs.existsSync(R + f) ? JSON.parse(fs.readFileSync(R + f, "utf8")) : null);
const metrics = [];
const add = (scenario, metric, median_ms, n, notes, p95_ms) => metrics.push({ scenario, metric, median_ms: median_ms ?? -1, ...(p95_ms !== undefined && p95_ms !== null ? { p95_ms } : {}), n, notes });

for (const set of ["small", "large"]) {
  const s = read(`server-${set}.json`);
  if (s) {
    for (const [name, x] of Object.entries(s.summary)) {
      add(`prod ${set} server ${name}`, "HTML total (curl-like GET, uncompressed)", x.total_ms, x.n, `${x.path.length > 70 ? x.path.slice(0, 70) + "…" : x.path}; status ${x.status}; TTFB ${x.ttfb_ms} ms; first hit ${x.first_total_ms} ms; ${x.kb} KB raw HTML in ${x.chunks} chunks (streamed: ${x.chunks > 1}); [data-list-ready] in stream at ${x.listReady_ms ?? "n/a"} ms; load ${s.loadBefore} -> ${s.loadAfter}`, x.total_p95_ms);
    }
  }
  for (const mode of ["desktop", "mobile"]) {
    const b = read(`browser-${set}-${mode}.json`);
    if (!b) continue;
    const label = mode === "desktop" ? "1440 no throttle" : "375 CPU 4x";
    for (const [name, x] of Object.entries(b.summary)) {
      add(`prod ${set} hard load ${name} @${label}`, "navigation start -> ready", x.ready, x.n, `TTFB ${x.ttfb}, FCP ${x.fcp}, LCP ${x.lcp}, hydrated ${x.hydrated}, load ${x.load} ms; long tasks total ${x.lt_total} ms (max ${x.lt_max}); JS ${x.js_kb} KB transferred in ${x.js_files} files, CSS ${x.css_kb} KB, HTML ${x.html_kb} KB gz / ${x.html_raw_kb} KB raw; DOM nodes at ready ${x.nodes}; errors ${x.errs}; load ${b.loadBefore} -> ${b.loadAfter}`, x.ready_p95);
    }
  }
  for (const thr of ["none", "cpu4"]) {
    const nv = read(`nav-${set}-${thr}.json`);
    if (!nv) continue;
    for (const [name, x] of Object.entries(nv.summary)) {
      add(`prod ${set} client nav ${name} @1440 ${thr === "none" ? "no throttle" : "CPU 4x"}`, "click -> ready", x.click_to_ready, x.n, `prefetched before click ${x.prefetched}; nav RSC ${x.nav_rsc_ms} ms / ${x.nav_rsc_kb} KB (${x.nav_rsc_reqs} req); long tasks click->ready ${x.lt_to_ready} ms; skeleton shown at ${x.skeleton_at} ms in ${x.skeleton_seen}/${x.n}; main thread busy after ready ${x.busy_after} ms; load ${nv.loadBefore} -> ${nv.loadAfter}`, x.p95);
    }
  }
}
for (const thr of ["none", "cpu4"]) {
  const it = read(`interactions-large-${thr}.json`);
  if (!it) continue;
  // The first no-throttle Power K search matched recents (invalid); the ONLY=powerk rerun replaces both Power K rows.
  const pk = thr === "none" ? read("interactions-large-none-powerk.json") : null;
  if (pk) for (const k of ["powerKOpen", "powerKSearch"]) it.summary[k] = { ...pk.summary[k], source: "interactions-large-none-powerk.json" };
  for (const k of Object.keys(it.summary)) if (it.summary[k].n === 0) delete it.summary[k];
  for (const [name, x] of Object.entries(it.summary)) {
    const extra = Object.entries(x).filter(([k]) => !["median", "p95", "n"].includes(k)).map(([k, v]) => `${k} ${v}`).join(", ");
    add(`prod large interaction ${name} @1440 ${thr === "none" ? "no throttle" : "CPU 4x"}`, "input -> visible result", x.median, x.n, `${extra}; setup ${JSON.stringify(it.setup)}; load ${it.loadBefore} -> ${it.loadAfter}`, x.p95);
  }
}
const bun = read("bundles.json");
if (bun) {
  for (const r of bun.routes) add(`prod bundle ${r.route}`, "first-load JS gzip KB (value is KB, not ms)", r.gzip_kb, 1, `${r.raw_kb} KB raw in ${r.chunks} chunks`);
  add("prod bundle shared by every route", "shared first-load JS gzip KB (value is KB, not ms)", bun.common.gzip_kb, 1, `${bun.common.raw_kb} KB raw in ${bun.common.chunks} chunks`);
  add("prod bundle CSS total", "CSS gzip KB (value is KB, not ms)", bun.totals.css_gzip_kb, 1, `${bun.totals.css_raw_kb} KB raw in ${bun.totals.css_files} files; all JS ${bun.totals.js_raw_kb} KB raw in ${bun.totals.js_files} files`);
  for (const c of bun.largest) add(`prod bundle chunk ${c.chunk}`, "chunk gzip KB (value is KB, not ms)", c.gzip_kb, 1, `${c.raw_kb} KB raw; first load of ${c.first_load_routes} routes; holds ${c.holds || "see hotspots"}`);
}
const spec = read("perf-spec.json");
if (spec) for (const [layout, x] of Object.entries(spec)) if (layout !== "_meta") add(`prod large perf spec ${layout} (decision 115)`, "navigation start -> [data-list-ready], 20 runs", x.p50, x.runs.length, `budget p95 <= 300 ms; max ${x.max}`, x.p95);
const rv = read("reveal-large.json");
if (rv) for (const [name, x] of Object.entries(rv.summary)) add(`prod large hard load ${name} @1440 no throttle (warm cache)`, "navigation start -> [data-list-ready] visible, no skeleton", x.ready, x.n, `TTFB ${x.ttfb}, response end ${x.respEnd}, FCP ${x.fcp} ms; "chunks blocked" aborts every /_next/static/chunks/*.js so only streamed HTML + React inline reveal scripts run; load ${rv.loadBefore} -> ${rv.loadAfter}`);
for (const thr of ["none", "cpu4"]) {
  const ab = read(`nav-ab-small-${thr}.json`);
  if (!ab) continue;
  for (const [name, x] of Object.entries(ab.summary)) {
    const arm = name.startsWith("A ") ? "A baseline" : "B blocking experiment (inbox+cycles: instant=false, no page Suspense)";
    add(`prod small A/B client nav ${name.slice(2)} @1440 ${thr === "none" ? "no throttle" : "CPU 4x"} [${arm}]`, "click -> ready", x.click_to_ready, x.n, `interleaved rounds; skeleton at ${x.skeleton_at} ms in ${x.skeleton_seen}/${x.n}; nav RSC ${x.nav_rsc_ms} ms / ${x.nav_rsc_kb} KB; prefetched ${x.prefetched}; busy after ${x.busy_after} ms; load ${ab.loadBefore} -> ${ab.loadAfter}`, x.p95);
  }
}
for (const f of ["bench-2.txt", "bench.txt"]) {
  if (!fs.existsSync(R + f)) continue;
  const txt = fs.readFileSync(R + f, "utf8");
  const loads = [...txt.matchAll(/load averages?: ([\d. ]+)/g)].map((m) => m[1].trim());
  for (const m of txt.matchAll(/^(.+?)\s+p50\s+([\d.]+) ms\s+p95\s+([\d.]+) ms\s+max\s+([\d.]+) ms\s+budget\s+(\d+) ms\s+(\S+)/gm))
    add(`engine perf:bench ${m[1].trim()} (${f})`, "engine call time, best of 3x50 runs", Number(m[2]), 150, `budget ${m[5]} ms (decision 115): ${m[6]}; max ${m[4]} ms; perf-spec.db (10000 PERF items); load ${loads.join(" -> ")}`, Number(m[3]));
}
fs.writeFileSync(R + "metrics.json", JSON.stringify(metrics, null, 1));
console.log(metrics.length, "metrics");

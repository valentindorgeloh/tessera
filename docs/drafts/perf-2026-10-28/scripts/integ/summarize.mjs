// Integrator: collect every A/B result of the 2026-10-28 round into one medians JSON (A = BEFORE, B = AFTER).
// Usage: node summarize.mjs <resultsDir> <out.json>
import fs from "node:fs";
import path from "node:path";
const [dir, outFile] = process.argv.slice(2);
const med = (a) => { a = a.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const flat = (o, p = "", out = {}) => {
  if (Array.isArray(o)) { if (o.every((x) => typeof x === "number")) out[p + "[max]"] = o.length ? Math.max(...o) : 0; return out; }
  if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); return out; }
  if (typeof o === "number") out[p] = o;
  return out;
};
const out = { generated: new Date().toISOString(), A: "BEFORE = BASE 6331186", B: "AFTER = BASE + lanes B and C", sets: {} };
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.startsWith("smoke"))) {
  const rows = fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const by = { A: [], B: [] }; const loads = [];
  for (const r of rows) { if (!r.sample) continue; const v = r.variant === "before" ? "A" : r.variant === "after" ? "B" : r.variant; by[v].push(flat(r.sample)); loads.push(parseFloat(String(r.load).split(/[ ,]+/)[0])); }
  const keys = [...new Set([...by.A, ...by.B].flatMap((o) => Object.keys(o)))];
  const metrics = {};
  for (const k of keys) { const a = med(by.A.map((o) => o[k])), b = med(by.B.map((o) => o[k])); metrics[k] = { A: a, B: b, pct: a && b != null ? Math.round(((b - a) / a) * 1000) / 10 : null }; }
  out.sets[f.replace(/\.jsonl$/, "")] = { nA: by.A.length, nB: by.B.length, load1m: { min: Math.min(...loads), max: Math.max(...loads), median: med(loads) }, metrics };
}
for (const f of fs.readdirSync(dir).filter((f) => /^(assets|peek)-.*\.json$/.test(f))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("samples")));
  if (r.routes) out.sets[f.replace(/\.json$/, "")] = { n: r.n, cpu: r.cpu, load: [r.load_before, r.load_after], routes: Object.fromEntries(Object.entries(r.routes).map(([k, v]) => [k, strip(v)])) };
  else out.sets[f.replace(/\.json$/, "")] = { n: r.n, delay: r.delay, load: r.load, A: r.A, B: r.B };
}
const pf = { A: [], B: [] }; const pfLoad = [];
for (const f of fs.readdirSync(dir).filter((f) => /^prefetch-[AB]-\d+\.json$/.test(f))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const s = r.steps.find((x) => x.step.startsWith("click nav Analytics"));
  const p = r.steps.find((x) => x.step.startsWith("click nav project Work items"));
  pf[f.split("-")[1]].push({ skeleton: s?.skeleton_ms, ready: s?.ready_ms, projSkeleton: p?.skeleton_ms, projReady: p?.ready_ms });
  pfLoad.push(r.load_before);
}
if (pf.A.length) out.sets.prefetch = { nA: pf.A.length, nB: pf.B.length, load: pfLoad, metrics: Object.fromEntries(["skeleton", "ready", "projSkeleton", "projReady"].map((k) => [k, { A: med(pf.A.map((x) => x[k])), B: med(pf.B.map((x) => x[k])), samplesA: pf.A.map((x) => x[k]), samplesB: pf.B.map((x) => x[k]) }])) };
for (const tag of ["after", "before", "after-2", "before-2"]) {
  const f = path.join(dir, `perf-spec-${tag}.log`);
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  (out.perfSpec ??= {})[tag] = { line: (t.match(/decision 115 \[data-list-ready\][^\n]*/) || [""])[0], start: (t.match(/^START[^\n]*/m) || [""])[0], end: (t.match(/^EXIT[^\n]*/m) || [""])[0] };
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(Object.keys(out.sets).join(" "));

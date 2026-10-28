import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]; };
const fit = (pts) => { const n = pts.length, sx = pts.reduce((a, [x]) => a + x, 0), sy = pts.reduce((a, [, y]) => a + y, 0), sxx = pts.reduce((a, [x]) => a + x * x, 0), sxy = pts.reduce((a, [x, y]) => a + x * y, 0); const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); const a = (sy - b * sx) / n; const ssr = pts.reduce((acc, [x, y]) => acc + (y - (a + b * x)) ** 2, 0); const mean = sy / n; const sst = pts.reduce((acc, [, y]) => acc + (y - mean) ** 2, 0); return { intercept: a, perRow: b, r2: 1 - ssr / sst }; };
for (const mode of ["grouped", "ungrouped"]) {
  const r = rows.filter((x) => x.mode === mode && x.runs);
  console.log(`== ${mode}`);
  const pts = { list: { p50: [], p95: [] }, table: { p50: [], p95: [] } };
  for (const x of r) {
    const nrows = mode === "grouped" ? x.size * 5 : x.size;
    const o = [`size ${x.size}`, `rows ${nrows}`, `nodes ${x.rows?.list?.nodes}/${x.rows?.table?.nodes}`, `listRows ${x.rows?.list?.rows}`, `load ${x.load.split(" ")[0]}-${x.loadAfter.split(" ")[0]}`];
    for (const l of ["list", "table"]) { const v = x.runs[l]; o.push(`${l} n${v.length} p50 ${pct(v, 50)} p95 ${pct(v, 95)} max ${Math.max(...v)}`); pts[l].p50.push([nrows, pct(v, 50)]); pts[l].p95.push([nrows, pct(v, 95)]); }
    console.log(o.join(" | "));
  }
  if (r.length >= 3) for (const l of ["list", "table"]) for (const k of ["p50", "p95"]) { const f = fit(pts[l][k]); const cap = f.perRow > 0 ? Math.floor((300 - f.intercept) / f.perRow) : null; console.log(`fit ${l} ${k}: intercept ${f.intercept.toFixed(0)} ms + ${f.perRow.toFixed(2)} ms/row, r2 ${f.r2.toFixed(3)}; 300 ms fits ${cap} rows`); }
}

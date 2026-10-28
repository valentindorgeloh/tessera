// MEASURE-CODE: medians per variant of an A/B jsonl ({variant, load, sample:{...nested numbers}}).
// Usage: node code-ab-median.mjs <file.jsonl>
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const by = {};
const flat = (o, p = "", acc = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object") flat(v, p + k + ".", acc);
    else if (typeof v === "number") acc[p + k] = v;
  }
  return acc;
};
for (const r of rows) {
  const b = (by[r.variant] ??= { n: 0, loads: [], m: {} });
  b.n++;
  b.loads.push(r.load.split(" ")[0]);
  for (const [k, v] of Object.entries(flat(r.sample))) (b.m[k] ??= []).push(v);
}
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
};
const out = {};
for (const [v, b] of Object.entries(by)) {
  out[v] = { n: b.n, load1m: b.loads.join(","), median: Object.fromEntries(Object.entries(b.m).map(([k, a]) => [k, med(a)])), min: Object.fromEntries(Object.entries(b.m).map(([k, a]) => [k, Math.min(...a)])), max: Object.fromEntries(Object.entries(b.m).map(([k, a]) => [k, Math.max(...a)])) };
}
console.log(JSON.stringify(out, null, 1));

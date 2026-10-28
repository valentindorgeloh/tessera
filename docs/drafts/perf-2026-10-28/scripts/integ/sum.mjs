// Usage: node sum.mjs <file.jsonl> [pathFilterRegex] -> median per variant per numeric leaf (arrays: max), with n and load range
import fs from "node:fs";
const [file, filter] = process.argv.slice(2);
const rows = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.sample);
const flat = (o, p = "", out = {}) => {
  if (Array.isArray(o)) { if (o.length && o.every((x) => typeof x === "number")) out[p + "[max]"] = Math.max(...o); else if (!o.length) out[p + "[max]"] = 0; return out; }
  if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); return out; }
  if (typeof o === "number") out[p] = o;
  return out;
};
const med = (a) => { a = a.filter((x) => typeof x === "number").sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const by = { A: [], B: [] };
const loads = [];
for (const r of rows) { by[r.variant].push(flat(r.sample)); loads.push(parseFloat(String(r.load).split(/[ ,]+/)[0])); }
const keys = [...new Set([...by.A, ...by.B].flatMap((o) => Object.keys(o)))].filter((k) => !filter || new RegExp(filter).test(k));
console.log(`n A=${by.A.length} B=${by.B.length} load1m ${Math.min(...loads)}..${Math.max(...loads)} (median ${med(loads)})`);
for (const k of keys) {
  const a = med(by.A.map((o) => o[k])), b = med(by.B.map((o) => o[k]));
  const pct = a && b !== null ? Math.round(((b - a) / a) * 100) : "";
  console.log(k.padEnd(48), String(a).padStart(8), String(b).padStart(8), pct === "" ? "" : `${pct}%`);
}

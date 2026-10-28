import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const med = (a) => { a = a.filter((x) => typeof x === "number").sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const flat = (o, p = "", out = {}) => { if (o && typeof o === "object" && !Array.isArray(o)) { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); } else if (typeof o === "number") out[p] = o; return out; };
const by = { A: [], B: [] }; const loads = [];
for (const r of rows) { if (!r.sample) continue; by[r.variant].push(flat(r.sample)); loads.push(parseFloat(r.load)); }
const keys = [...new Set([...by.A, ...by.B].flatMap((o) => Object.keys(o)))].filter((k) => !process.argv[3] || new RegExp(process.argv[3]).test(k));
console.log("n", by.A.length, by.B.length, "load", Math.min(...loads), Math.max(...loads));
for (const k of keys) { const a = med(by.A.map((o) => o[k])), b = med(by.B.map((o) => o[k])); console.log(k.padEnd(28), String(a).padStart(8), String(b).padStart(8), a ? `${(((b - a) / a) * 100).toFixed(1)}%` : ""); }

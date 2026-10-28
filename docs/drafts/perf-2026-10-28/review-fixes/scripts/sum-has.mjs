import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log("load", j.load, "reps", j.reps);
for (const [sc, r] of Object.entries(j.results)) for (const m of ["has", "class"]) {
  const k = (f) => med(r[m].map((x) => x[f])).toFixed(1);
  console.log(sc.padEnd(8), m.padEnd(6), "style", k("style"), "styleN", k("styleN"), "layout", k("layout"), "script", k("script"), "task", k("task"), "swapped", r[m][0].swapped, "n", r[m].length);
}

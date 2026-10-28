import fs from "node:fs";
const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
const files = process.argv.slice(2);
const out = [];
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(f)); const rows = o.rows.filter((r) => !r.error && r.trace);
  const fold = (g) => { const r = {}; for (const [k, v] of Object.entries(g)) { const kk = k.startsWith("other:") ? "other" : k; r[kk] = (r[kk] ?? 0) + v; } return r; };
  const keys = ["script-call", "evaluate-script", "compile", "style", "layout", "paint-commit", "parse", "gc", "other"];
  const lg = rows.map((r) => fold(r.trace.longestTasks[0].groups)); const wg = rows.map((r) => fold(r.trace.window));
  const m = (arr) => Object.fromEntries(keys.map((k) => [k, med(arr.map((x) => x[k] ?? 0))]));
  const line = { tag: o.tag, n: rows.length, ready: o.summary.ready.median, longestMs: med(rows.map((r) => r.trace.longestTasks[0].durMs)), longestStart: med(rows.map((r) => r.trace.longestTasks[0].startMs)), longestGroups: m(lg), windowGroups: m(wg), taskTotal: med(rows.map((r) => r.trace.taskTotalMs)), over50: med(rows.map((r) => r.trace.tasksOver50)), topNames: rows[0].trace.longestTasks[0].names };
  out.push(line);
  console.log(`${line.tag.padEnd(30)} n=${line.n} ready ${line.ready} | longest ${line.longestMs}ms @${line.longestStart} {${keys.map((k) => `${k.replace("script-call", "js").replace("paint-commit", "paint").replace("evaluate-script", "evalS")}:${line.longestGroups[k]}`).join(" ")}} | window {${keys.map((k) => `${k.replace("script-call", "js").replace("paint-commit", "paint").replace("evaluate-script", "evalS")}:${line.windowGroups[k]}`).join(" ")}} taskTotal ${line.taskTotal} >50ms:${line.over50}`);
}
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));

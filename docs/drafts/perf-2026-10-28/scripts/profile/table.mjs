import fs from "node:fs";
const files = process.argv.slice(2);
for (const f of files) {
  const o = JSON.parse(fs.readFileSync(f, "utf8"));
  const ok = o.rows.filter((r) => !r.error);
  const s = o.summary;
  console.log(`${o.tag.padEnd(34)} n=${s.n} ready med ${s.ready.median} [${s.ready.min}-${s.ready.max}] p95 ${s.ready.p95} | ltMax ${s.ltMax} ltSum ${s.ltSum} | script ${s.cdp.ScriptDuration} style ${s.cdp.RecalcStyleDuration} layout ${s.cdp.LayoutDuration} task ${s.cdp.TaskDuration} | el ${s.census.el} | load ${o.rows.map((r) => (r.load || "").split(" ")[0]).join(",")}`);
}

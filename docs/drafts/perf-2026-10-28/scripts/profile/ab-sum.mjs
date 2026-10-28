// usage: node ab-sum.mjs <prefix e.g. ab-rpwc> <set-vp-sc>
import fs from "node:fs";
const [pre, cell] = process.argv.slice(2); const R = "/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc/results/";
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
const rd = (arm) => fs.readdirSync(R).filter((f) => f.startsWith(`profile-${pre}-${arm}-${cell}-`) && f.endsWith(".json") && !f.includes(".s")).map((f) => JSON.parse(fs.readFileSync(R + f)).rows[0]).filter((r) => r && !r.error);
const A = rd("A"), B = rd("B"); const f = (rs, k) => med(rs.map(k));
const line = (n, rs) => `${n} n=${rs.length} ready ${f(rs, (r) => r.ready)} [${rs.map((r) => r.ready).join(",")}] ltMax ${f(rs, (r) => r.ltMax)} script ${f(rs, (r) => r.cdp.ScriptDuration)} style ${f(rs, (r) => r.cdp.RecalcStyleDuration)} styleCount ${f(rs, (r) => r.cdp.RecalcStyleCount)} layout ${f(rs, (r) => r.cdp.LayoutDuration)} task ${f(rs, (r) => r.cdp.TaskDuration)} el ${f(rs, (r) => r.census.el)} loads ${rs.map((r) => r.load.split(" ")[0]).join(",")}`;
console.log(`${pre} ${cell}`); console.log(line("A", A)); console.log(line("B", B));

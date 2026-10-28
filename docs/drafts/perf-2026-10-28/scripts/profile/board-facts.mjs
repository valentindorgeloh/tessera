import fs from "node:fs";
for (const f of process.argv.slice(2)) {
  const tr = JSON.parse(fs.readFileSync(f, "utf8")); const ev = tr.traceEvents ?? tr;
  const names = new Map(); for (const e of ev) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
  const byTid = new Map(); for (const e of ev) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
  const main = [...byTid.keys()].filter((k) => names.get(k) === "CrRendererMain").sort((a, b) => byTid.get(b) - byTid.get(a))[0];
  const me = ev.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts);
  const resp = me.filter((e) => e.name === "ResourceReceiveResponse" && e.args?.data?.mimeType === "text/html").pop(); const t0 = resp.ts;
  const r = (ts) => Math.round((ts - t0) / 1000);
  const parse = me.filter((e) => e.name === "ParseHTML" && e.ts >= t0).map((e) => [r(e.ts), +(e.dur / 1000).toFixed(1)]);
  const dcl = me.find((e) => e.name === "domContentLoadedEventEnd" && e.ts > t0);
  const fp = me.find((e) => e.name === "firstPaint" && e.ts > t0); const fcp = me.find((e) => e.name === "firstContentfulPaint" && e.ts > t0);
  const tasks = me.filter((e) => e.ph === "X" && e.name === "RunTask" && e.ts >= t0);
  const big = tasks.filter((e) => e.dur > 300000)[0];
  const paints = me.filter((e) => e.name === "Paint" && e.ts >= t0 && e.dur > 1000).map((e) => [r(e.ts), +(e.dur / 1000).toFixed(1)]).slice(0, 4);
  const tick = me.filter((e) => e.name === "FunctionCall" && e.args?.data?.functionName === "tick" && e.ts >= t0).map((e) => [r(e.ts), +(e.dur / 1000).toFixed(1)]).slice(0, 4);
  console.log(f.split("/").pop().replace("profile-board-large-d-trace.", ""), JSON.stringify({ htmlResponseAt: 0, parseHTMLTasks: parse.length, parseFirst: parse.slice(0, 6), dclAt: dcl && r(dcl.ts), firstPaintAt: fp && r(fp.ts), longTaskStart: big && r(big.ts), longTaskMs: big && Math.round(big.dur / 1000), framesWithPaintBeforeLongTask: paints.filter(([t]) => big && t < r(big.ts)).length, paints, tick }));
}

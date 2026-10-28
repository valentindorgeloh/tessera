// detailed window: node timeline2.mjs <trace> <fromMs> <toMs> [minUs=300]
import fs from "node:fs";
const [file, fromA, toA, minA = "300"] = process.argv.slice(2);
const tr = JSON.parse(fs.readFileSync(file, "utf8")); const ev = tr.traceEvents ?? tr;
const names = new Map(); for (const e of ev) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
const byTid = new Map(); for (const e of ev) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
const main = [...byTid.keys()].filter((k) => names.get(k) === "CrRendererMain").sort((a, b) => byTid.get(b) - byTid.get(a))[0];
const me = ev.filter((e) => `${e.pid}:${e.tid}` === main);
const nav = me.filter((e) => e.name === "navigationStart").pop(); const dcl = me.filter((e) => e.name === "domContentLoadedEventEnd");
// t0 aligned to the html response start of the last navigation
const resp = me.filter((e) => e.name === "ResourceReceiveResponse" && e.args?.data?.mimeType === "text/html").pop();
const t0 = resp ? resp.ts - 146000 : nav.ts; // same origin choice as timeline.mjs (response at ~146)
const rel = (ts) => (ts - t0) / 1000;
const from = Number(fromA), to = Number(toA), min = Number(minA);
const rows = [];
for (const e of me) {
  const r = rel(e.ts); if (r < from || r > to) continue;
  if (e.ph === "X" && e.dur >= min && e.name !== "ThreadControllerImpl::RunTask") rows.push([e.ts, `${r.toFixed(1).padStart(7)} ${e.name} ${(e.dur / 1000).toFixed(1)}ms ${e.args?.data?.url ? e.args.data.url.split("/").pop().slice(0, 30) : ""}${e.args?.data?.functionName ? " fn=" + e.args.data.functionName : ""}`]);
  else if (e.ph !== "X" && !["ThreadControllerImpl::RunTask"].includes(e.name) && ["ResourceSendRequest", "ResourceReceiveResponse", "ResourceFinish", "firstPaint", "firstContentfulPaint", "domContentLoadedEventEnd", "loadEventEnd", "RequestAnimationFrame", "ScheduleStyleRecalculation", "TimerInstall", "markDOMContent", "BeginMainThreadFrame", "ActivateLayerTree", "Commit"].includes(e.name)) rows.push([e.ts, `${r.toFixed(1).padStart(7)} .. ${e.name} ${e.args?.data?.url ? e.args.data.url.split("/").pop().slice(0, 30) : ""}`]);
}
rows.sort((a, b) => a[0] - b[0]); for (const x of rows.slice(0, 200)) console.log(x[1]);

// client-nav timeline: node timeline3.mjs <trace> <minMs> ; origin = first RunTask that contains an EventDispatch 'click' (or first ResourceSendRequest of rsc)
import fs from "node:fs";
const [file, minA = "3"] = process.argv.slice(2);
const tr = JSON.parse(fs.readFileSync(file, "utf8")); const ev = tr.traceEvents ?? tr;
const names = new Map(); for (const e of ev) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
const byTid = new Map(); for (const e of ev) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
const main = [...byTid.keys()].filter((k) => names.get(k) === "CrRendererMain").sort((a, b) => byTid.get(b) - byTid.get(a))[0];
const me = ev.filter((e) => `${e.pid}:${e.tid}` === main).sort((a, b) => a.ts - b.ts);
const click = me.find((e) => e.name === "EventDispatch" && (e.args?.data?.type === "click"));
const t0 = click ? click.ts : me[0].ts;
for (const e of me) {
  const r = (e.ts - t0) / 1000; if (r < -5) continue;
  const big = e.ph === "X" && e.dur >= Number(minA) * 1000 && !["ThreadControllerImpl::RunTask"].includes(e.name);
  const mark = ["ResourceSendRequest", "ResourceFinish", "ResourceReceiveResponse"].includes(e.name) && e.args?.data?.url;
  if (big) console.log(`${r.toFixed(0).padStart(6)} ${e.name} ${(e.dur / 1000).toFixed(1)}ms ${e.args?.data?.url?.split("/").pop().slice(0, 40) ?? e.args?.data?.functionName ?? e.args?.data?.type ?? ""}`);
  else if (mark) console.log(`${r.toFixed(0).padStart(6)} .. ${e.name} ${e.args.data.url.split("/").pop().slice(0, 50)}`);
}

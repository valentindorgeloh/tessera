// Timeline of one navigation trace: usage: node timeline.mjs <trace.json> [minMs=4]
import fs from "node:fs";
const [file, minArg = "4"] = process.argv.slice(2); const MIN = Number(minArg);
const tr = JSON.parse(fs.readFileSync(file, "utf8")); const ev = tr.traceEvents ?? tr;
const names = new Map(); for (const e of ev) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
const byTid = new Map(); for (const e of ev) if (e.ph === "X" && e.name === "RunTask") byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) ?? 0) + e.dur);
const main = [...byTid.keys()].filter((k) => names.get(k) === "CrRendererMain").sort((a, b) => byTid.get(b) - byTid.get(a))[0];
const me = ev.filter((e) => `${e.pid}:${e.tid}` === main);
// navigation start: the last 'navigationStart' marker, else first event
const nav = me.filter((e) => e.name === "navigationStart" && e.args?.data?.documentLoaderURL?.includes("/work-items")).pop() ?? me.find((e) => e.name === "navigationStart");
const t0 = nav ? nav.ts : Math.min(...me.map((e) => e.ts));
const rel = (ts) => Math.round((ts - t0) / 1000);
const lines = [];
for (const e of me) {
  if (e.ts < t0 - 1000) continue;
  const r = rel(e.ts);
  if (e.ph === "X" && e.name === "RunTask" && e.dur >= MIN * 1000) lines.push([e.ts, `${String(r).padStart(5)} ms  TASK ${Math.round(e.dur / 1000)} ms`]);
  else if (e.ph === "X" && ["EvaluateScript", "v8.compile", "ParseHTML", "UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Commit", "FunctionCall", "TimerFire", "FireAnimationFrame", "EventDispatch", "v8.run"].includes(e.name) && e.dur >= MIN * 1000) {
    const u = e.args?.data?.url ? e.args.data.url.split("/").pop().slice(0, 40) : e.args?.data?.functionName ?? e.args?.data?.type ?? "";
    lines.push([e.ts, `${String(r).padStart(5)} ms    ${e.name} ${Math.round(e.dur / 1000)} ms ${u}`]);
  } else if (["firstPaint", "firstContentfulPaint", "firstMeaningfulPaint", "domContentLoadedEventEnd", "loadEventEnd", "largestContentfulPaint::Candidate", "markDOMContent", "markLoad"].includes(e.name)) lines.push([e.ts, `${String(r).padStart(5)} ms  >> ${e.name}`]);
  else if (e.name === "ResourceReceiveResponse" && e.args?.data?.mimeType === "text/html") lines.push([e.ts, `${String(r).padStart(5)} ms  >> html response`]);
  else if (e.name === "ResourceFinish" && e.args?.data?.didFail === false && me.length && lines.length < 1e9 && e.args?.data?.encodedDataLength > 100000) lines.push([e.ts, `${String(r).padStart(5)} ms  >> resource finish ${e.args.data.encodedDataLength}`]);
  else if (e.name === "Commit" && e.ph === "I") lines.push([e.ts, `${String(r).padStart(5)} ms  >> commit(i)`]);
}
lines.sort((a, b) => a[0] - b[0]);
console.log(file.split("/").pop(), "main", main);
for (const l of lines.slice(0, 160)) console.log(l[1]);

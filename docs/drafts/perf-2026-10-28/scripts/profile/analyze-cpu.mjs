// Attribute a .cpuprofile (from the profiling build with source maps) to source files and functions.
// usage: node analyze-cpu.mjs <profile.cpuprofile> [outJson]
import fs from "node:fs"; import path from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
const [file, outArg] = process.argv.slice(2);
const DIST = "/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf/bc/profile/.next-prof/static/chunks/";
const prof = JSON.parse(fs.readFileSync(file, "utf8"));
const maps = new Map();
const mapFor = (url) => { const f = url.replace(/^https?:\/\/[^/]+\/_next\/static\/chunks\//, "").replace(/\?.*$/, ""); if (maps.has(f)) return maps.get(f); let tm = null; try { const js = fs.readFileSync(DIST + f, "utf8"); const m = js.slice(-300).match(/sourceMappingURL=([^\s]+)/); const mf = m ? m[1] : f + ".map"; tm = new TraceMap(fs.readFileSync(DIST + mf, "utf8")); } catch {} maps.set(f, tm); return tm; };
const bucketOf = (src, fnName, url) => {
  if (!src) { if (/^\(/.test(fnName)) return fnName; return url ? "unmapped-js" : "native/" + (fnName || "?"); }
  const s = src.replace(/^turbopack:\/\/\/\[project\]\//, "").replace(/^.*?(node_modules\/)/, "$1");
  if (s.includes("node_modules/@astryxdesign/core")) return "astryx";
  if (/node_modules\/(react-dom|react\/|scheduler)/.test(s)) return /react-dom/.test(s) ? "react-dom" : "react/scheduler";
  if (/compiled\/react-dom/.test(s)) return "react-dom"; if (/compiled\/(react\/|scheduler)/.test(s)) return "react/scheduler"; if (/react-server-dom/.test(s)) return "flight-client";
  if (s.includes("node_modules/next/")) return "next";
  if (s.startsWith("src/")) return "app(src)";
  if (s.includes("node_modules/@tiptap") || s.includes("prosemirror") || s.includes("node_modules/yjs") || s.includes("lowlight") || s.includes("highlight.js")) return "editor-libs";
  if (s.includes("node_modules/")) return "lib:" + (s.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? "?");
  return "other:" + s.slice(0, 40);
};
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map(); const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (dt[i] ?? 0));
const info = new Map(); // node id -> {bucket, name, src}
for (const n of prof.nodes) {
  const cf = n.callFrame; let src = null, name = cf.functionName || "(anon)";
  if (cf.url && cf.lineNumber >= 0) { const tm = mapFor(cf.url); if (tm) { const o = originalPositionFor(tm, { line: cf.lineNumber + 1, column: cf.columnNumber }); if (o.source) { src = o.source; if (o.name) name = o.name; } } }
  info.set(n.id, { bucket: bucketOf(src, cf.functionName, cf.url), name, src: src ? src.replace(/^turbopack:\/\/\/\[project\]\//, "").replace(/^.*?(node_modules\/)/, "$1") : null, url: cf.url });
}
const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
const byBucket = {}, byFn = {}, bySrc = {};
for (const [id, us] of self) { const i = info.get(id); byBucket[i.bucket] = (byBucket[i.bucket] ?? 0) + us / 1000; const k = `${i.name} @ ${(i.src ?? i.url ?? "").split("/").slice(-3).join("/")}`; byFn[k] = (byFn[k] ?? 0) + us / 1000; if (i.src) bySrc[i.src] = (bySrc[i.src] ?? 0) + us / 1000; }
// inclusive time per function name (outermost occurrence per path)
const incl = new Map();
const inclAdd = (id, us) => { const seen = new Set(); let cur = id; while (cur != null) { const i = info.get(cur); const k = i.name + " @ " + (i.src ?? "").split("/").slice(-2).join("/"); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + us); } cur = parent.get(cur); } };
for (const [id, us] of self) inclAdd(id, us);
const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([n, ms]) => [n, Math.round(ms)]);
const inclTop = [...incl.entries()].map(([k, v]) => [k, Math.round(v / 1000)]).sort((a, b) => b[1] - a[1]);
const KEYS = /readPortalWritingContext|requestContextMount|sentinelRefCallback|useLayer|usePopover|useTooltip|Tooltip|Popover|Selector|useTruncation|renderOptions|ListItem|HStack|Text @|Token|DateControl|StateControl|PriorityControl|CycleControl|CheckboxInput|Button @|Avatar|StatusDot|Badge|OneLineText|WorkItemRow|RowProperties|RowProject|hydrateRoot|performWorkUntilDeadline|performSyncWorkOnRoot|performConcurrentWorkOnRoot|commitRoot|flushPassiveEffects|flushLayoutEffects|commitMutationEffects|commitLayoutEffects|beginWork|completeWork|hydrat|attachRef|safelyAttachRef/;
const keyIncl = inclTop.filter(([k]) => KEYS.test(k)).slice(0, 60);
const CALLEES = (process.env.CALLERS ?? "readPortalWritingContext,useTruncation,observeResize,checkVisibility,getComputedStyle").split(",");
const callers = {};
for (const [id, us] of self) { const i0 = info.get(id); const chain = []; let cur = id; while (cur != null) { chain.push(info.get(cur)); cur = parent.get(cur); }
  for (const key of CALLEES) { const idx = chain.findIndex((c) => c.name === key || (c.src ?? "").includes(key)); if (idx < 0) continue; const above = chain.slice(idx + 1).filter((c) => c.src && /Astryx|astryx|src\//.test(c.src) && !/useLayer|useTruncation/.test(c.src)).slice(0, 3).map((c) => c.name).join(" < "); const k = key + " <- " + above; callers[k] = (callers[k] ?? 0) + us / 1000; } }
const res = { callers: Object.entries(callers).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => [k, Math.round(v)]), file: path.basename(file), profiledMs: Math.round(total), byBucket: top(byBucket, 14), bySrc: top(bySrc, 25), byFn: top(byFn, 40), inclusiveTop: inclTop.slice(0, 50), keyInclusive: keyIncl };
if (outArg) fs.writeFileSync(outArg, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ profiledMs: res.profiledMs, byBucket: res.byBucket }));
if (!outArg) { console.log("BYFN", JSON.stringify(res.byFn.slice(0, 25), null, 0)); console.log("INCL", JSON.stringify(res.keyInclusive.slice(0, 30))); }

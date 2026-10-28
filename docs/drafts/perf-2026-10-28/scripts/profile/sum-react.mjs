import fs from "node:fs";
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
const out = {};
for (const f of process.argv.slice(2)) {
  const o = JSON.parse(fs.readFileSync(f)); const rows = o.rows.filter((r) => !r.error && r.react);
  const names = new Set(rows.flatMap((r) => Object.keys(r.react.byName)));
  const agg = {}; for (const n of names) agg[n] = { n: med(rows.map((r) => r.react.byName[n]?.n ?? 0)), mount: med(rows.map((r) => r.react.byName[n]?.mount ?? 0)), ms: +med(rows.map((r) => r.react.byName[n]?.ms ?? 0)).toFixed(1) };
  const totalMs = med(rows.map((r) => Object.values(r.react.byName).reduce((a, v) => a + v.ms, 0)));
  const totalN = med(rows.map((r) => Object.values(r.react.byName).reduce((a, v) => a + v.n, 0)));
  const totalMount = med(rows.map((r) => Object.values(r.react.byName).reduce((a, v) => a + v.mount, 0)));
  const commits = med(rows.map((r) => r.react.nCommits));
  const big = rows.map((r) => r.react.commits.filter((c) => c.dur >= 5).map((c) => `${c.dur}ms/${c.comps}c`).join(" "));
  const top = Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms).slice(0, 14);
  // families
  const FAM = { layers: /^(Selector|Popover|Tooltip|DropdownMenuPopover|LayerContentBoundary|LayerDepthProvider|Overlay|Layer\w*|HoverCard|useLayer)$/, rowShell: /^(Item|ListItem|WorkItemRow|RowProperties|RowProject|ListLayout|GroupSection)$/, controls: /^(DateControl|StateControl|PriorityControl|CycleControl|Selector|Button|Token|Avatar|CheckboxInput|Badge|StatusDot|Field|FieldLabel)$/, layout: /^(Stack|HStack|VStack|Text|Icon|IconFromRegistry|VisuallyHidden|Kbd)$/, table: /^(Table\w*|DataTable\w*|Row|Cell\w*|Column\w*)$/ };
  const fam = {}; for (const [k, re] of Object.entries(FAM)) { const m = Object.entries(agg).filter(([n]) => re.test(n)); fam[k] = { n: m.reduce((a, [, v]) => a + v.n, 0), mount: m.reduce((a, [, v]) => a + v.mount, 0), ms: +m.reduce((a, [, v]) => a + v.ms, 0).toFixed(1) }; }
  out[o.tag] = { n: rows.length, ready: o.summary.ready.median, ltMax: o.summary.ltMax, totalSelfMs: +totalMs.toFixed(1), totalRenders: totalN, totalMounts: totalMount, commits, bigCommits: big[0], top: top.map(([k, v]) => `${k} ${v.ms}ms n${v.n}/m${v.mount}`), fam, hookMs: med(rows.map((r) => r.react.hookMs)) };
  console.log(o.tag.padEnd(26), `n=${rows.length} ready ${o.summary.ready.median} ltMax ${o.summary.ltMax} | render self ${totalMs.toFixed(0)}ms renders ${totalN} mounts ${totalMount} commits ${commits} hookOverhead ${out[o.tag].hookMs}ms`);
  console.log("   big commits:", big[0]); console.log("   top:", out[o.tag].top.slice(0, 10).join(" | ")); console.log("   fam:", JSON.stringify(fam));
}
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));

// e. First-load JS per route (from .next/diagnostics/route-bundle-stats.json), gzip sizes, CSS totals, the largest
// client chunks and which packages they hold (string fingerprints, since production chunks carry no paths).
// Usage: node bundles.mjs <build dir>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dir = process.argv[2];
const next = path.join(dir, ".next");
const stats = JSON.parse(fs.readFileSync(path.join(next, "diagnostics/route-bundle-stats.json"), "utf8"));
const gz = new Map();
const gzip = (file) => {
  if (!gz.has(file)) gz.set(file, zlib.gzipSync(fs.readFileSync(path.join(dir, file)), { level: 6 }).length);
  return gz.get(file);
};
const size = (file) => fs.statSync(path.join(dir, file)).size;

const routes = stats
  .map((r) => ({
    route: r.route,
    chunks: r.firstLoadChunkPaths.length,
    raw_kb: Math.round(r.firstLoadUncompressedJsBytes / 1024),
    gzip_kb: Math.round(r.firstLoadChunkPaths.reduce((s, f) => s + gzip(f), 0) / 1024),
  }))
  .sort((a, b) => b.raw_kb - a.raw_kb);

// Chunks shared by every route (the root + tessera layout).
const sets = stats.map((r) => new Set(r.firstLoadChunkPaths));
const tessera = stats.filter((r) => r.route !== "/_not-found" && r.route !== "/_global-error");
const common = [...new Set(tessera[0].firstLoadChunkPaths)].filter((f) => tessera.every((r) => r.firstLoadChunkPaths.includes(f)));
const commonRaw = common.reduce((s, f) => s + size(f), 0);
const commonGz = common.reduce((s, f) => s + gzip(f), 0);

const chunkDir = path.join(next, "static/chunks");
const all = fs.readdirSync(chunkDir).map((f) => ({ f, size: fs.statSync(path.join(chunkDir, f)).size }));
const js = all.filter((x) => x.f.endsWith(".js")).sort((a, b) => b.size - a.size);
const css = all.filter((x) => x.f.endsWith(".css"));

const FINGERPRINTS = [
  ["react-dom", /react-dom|__reactFiber|scheduler\.unstable/],
  ["next router", /next-router-state-tree|__next_f|NEXT_ROUTER/],
  ["@tiptap", /tiptap|addProseMirrorPlugins/],
  ["prosemirror", /ProseMirror|prosemirror/],
  ["lowlight/highlight.js", /hljs|highlight\.js|lowlight/],
  ["recharts", /recharts|ResponsiveContainer/],
  ["d3 (recharts)", /d3-scale|scaleLinear|curveMonotoneX/],
  ["@astryxdesign/core", /astryx-/],
  ["@phosphor-icons", /phosphor|IconContext/],
  ["zod", /ZodError|_zod/],
  ["markdown-it/marked", /markdown-it|marked\.|lexer/],
  ["fractional-indexing", /generateKeyBetween/],
  ["uuid", /randomUUID|uuid/],
  ["tessera app code", /tessera-/],
];
const largest = js.slice(0, 12).map(({ f, size: s }) => {
  const text = fs.readFileSync(path.join(chunkDir, f), "utf8");
  const holds = FINGERPRINTS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const usedBy = stats.filter((r) => r.firstLoadChunkPaths.includes(`.next/static/chunks/${f}`)).length;
  return { chunk: f, raw_kb: Math.round(s / 1024), gzip_kb: Math.round(gzip(`.next/static/chunks/${f}`) / 1024), first_load_routes: usedBy, holds: holds.join(", ") };
});

const cssRaw = css.reduce((s, x) => s + x.size, 0);
const cssGz = css.reduce((s, x) => s + gzip(`.next/static/chunks/${x.f}`), 0);
const out = {
  routes,
  common: { chunks: common.length, raw_kb: Math.round(commonRaw / 1024), gzip_kb: Math.round(commonGz / 1024) },
  totals: { js_files: js.length, js_raw_kb: Math.round(js.reduce((s, x) => s + x.size, 0) / 1024), css_files: css.length, css_raw_kb: Math.round(cssRaw / 1024), css_gzip_kb: Math.round(cssGz / 1024) },
  largest,
};
fs.writeFileSync(new URL("../results/bundles.json", import.meta.url), JSON.stringify(out, null, 2));
console.table(routes);
console.log("common", out.common, "totals", out.totals);
console.table(largest);

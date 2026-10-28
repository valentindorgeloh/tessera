// MEASURE-CODE: first-load JS per route from a production build (Turbopack), read-only.
// Usage: node code-route-js.mjs <build root> <out.json>
// Route JS = rootMainFiles + every non-async chunk named by the route's page_client-reference-manifest.
// Also reports which heavy libraries (by module path) sit in those chunks.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [root, out] = process.argv.slice(2);
const next = path.join(root, ".next");
const bm = JSON.parse(fs.readFileSync(path.join(next, "build-manifest.json"), "utf8"));
const rootMain = bm.rootMainFiles.map((f) => "/_next/" + f);
const appDir = path.join(next, "server/app");
const manifests = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "page_client-reference-manifest.js") manifests.push(p);
  }
})(appDir);
const size = new Map();
const gz = new Map();
const chunkFile = (c) => path.join(next, c.replace(/^\/_next\//, ""));
const fileSize = (c) => {
  if (!size.has(c)) {
    const buf = fs.readFileSync(chunkFile(c));
    size.set(c, buf.length);
    gz.set(c, zlib.gzipSync(buf).length);
  }
  return size.get(c);
};
const HEAVY = { tiptap: /@tiptap|prosemirror/, lowlight: /lowlight|highlight\.js/, recharts: /recharts|d3-|victory/, phosphor: /@phosphor-icons/, zod: /node_modules\/zod/, astryx: /@astryxdesign/, markdown: /markdown|micromark|mdast|remark/ };
const rows = [];
for (const m of manifests) {
  const src = fs.readFileSync(m, "utf8");
  globalThis.__RSC_MANIFEST = {};
  new Function(src)();
  const [key, val] = Object.entries(globalThis.__RSC_MANIFEST)[0];
  const sync = new Set(rootMain);
  const async = new Set();
  const libs = {};
  for (const [mod, info] of Object.entries(val.clientModules)) {
    for (const c of info.chunks) (info.async ? async : sync).add(c);
    for (const [lib, re] of Object.entries(HEAVY)) if (re.test(mod) && !info.async) libs[lib] = (libs[lib] ?? 0) + 1;
  }
  const syncList = [...sync].filter((c) => c.endsWith(".js"));
  const bytes = syncList.reduce((a, c) => a + fileSize(c), 0);
  const gzBytes = syncList.reduce((a, c) => (fileSize(c), a + gz.get(c)), 0);
  rows.push({ route: key.replace("/page", ""), chunks: syncList.length, kb: Math.round(bytes / 1024), gzKb: Math.round(gzBytes / 1024), heavyClientModules: libs });
}
rows.sort((a, b) => b.kb - a.kb);
// Library presence by scanning chunk text for module markers.
const libChunks = {};
for (const c of size.keys()) {
  const txt = fs.readFileSync(chunkFile(c), "utf8");
  for (const [lib, re] of Object.entries({ tiptap: /ProseMirror|prosemirror/, lowlight: /hljs|lowlight/, recharts: /recharts/, phosphor: /duotone/ })) if (re.test(txt)) (libChunks[lib] ??= []).push([c, Math.round(size.get(c) / 1024)]);
}
fs.writeFileSync(out, JSON.stringify({ rootMainKb: Math.round(rootMain.reduce((a, c) => a + fileSize(c), 0) / 1024), routes: rows, libChunks }, null, 2));
for (const r of rows) console.log(String(r.kb).padStart(6), "KB", String(r.gzKb).padStart(5), "gz", r.route, JSON.stringify(r.heavyClientModules));
console.log("lib chunks", JSON.stringify(libChunks));

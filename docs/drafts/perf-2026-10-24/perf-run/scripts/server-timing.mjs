// a. Server timing per route: TTFB (headers + first body chunk), total, chunk count, and when key markers
// first appear in the HTML stream. Interleaves routes inside each round. Usage: node server-timing.mjs <small|large> [rounds=7] [tag]
import http from "node:http";
import fs from "node:fs";
import { SETS, routesFor, median, pct, load } from "./routes.mjs";

const set = process.argv[2] ?? "small";
const rounds = Number(process.argv[3] ?? 7);
const tag = process.argv[4] ?? "";
const { port } = SETS[set];
const routes = routesFor(set);
const OUT = new URL(`../results/server-${set}${tag ? "-" + tag : ""}.json`, import.meta.url).pathname;

function hit(path) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const marks = {};
    let firstByte = null;
    let bytes = 0;
    let chunks = 0;
    let body = "";
    const req = http.get({ host: "127.0.0.1", port, path, headers: { accept: "text/html" } }, (res) => {
      const headers = performance.now() - t0;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        const t = performance.now() - t0;
        if (firstByte === null) firstByte = t;
        chunks += 1;
        bytes += Buffer.byteLength(chunk);
        body += chunk;
        for (const [name, needle] of [
          ["main", "role=\"main\""],
          ["listReady", "data-list-ready"],
          ["h1", "<h1"],
          ["sidebarNav", "Your work"],
          ["htmlEnd", "</html>"],
        ]) {
          if (marks[name] === undefined && body.includes(needle)) marks[name] = t;
        }
      });
      res.on("end", () => {
        const total = performance.now() - t0;
        const pendingInShell = (body.slice(0, body.indexOf("</html>") > 0 ? body.indexOf("</html>") : body.length).match(/<!--\$\?-->/g) ?? []).length;
        resolve({ status: res.statusCode, headers, firstByte, total, bytes, chunks, marks, suspenseBoundaries: (body.match(/<!--\$\?-->/g) ?? []).length, pendingInShell, streamed: chunks > 1 });
      });
    });
    req.on("error", reject);
  });
}

const result = { set, port, rounds, startedAt: new Date().toISOString(), loadBefore: load(), first: {}, runs: {} };
for (const [name, path] of routes) {
  result.first[name] = await hit(path);
  result.runs[name] = [];
}
for (let r = 0; r < rounds; r++) {
  for (const [name, path] of routes) result.runs[name].push(await hit(path));
}
result.loadAfter = load();
result.summary = {};
for (const [name, path] of routes) {
  const runs = result.runs[name];
  const f = (k) => runs.map((x) => x[k]);
  const m = (k) => runs.map((x) => x.marks[k]);
  result.summary[name] = {
    path,
    status: runs[0].status,
    first_total_ms: +result.first[name].total.toFixed(1),
    ttfb_ms: +median(f("firstByte")).toFixed(1),
    total_ms: +median(f("total")).toFixed(1),
    total_p95_ms: +pct(f("total"), 95).toFixed(1),
    main_ms: median(m("main")) === null ? null : +median(m("main")).toFixed(1),
    listReady_ms: median(m("listReady")) === null ? null : +median(m("listReady")).toFixed(1),
    kb: +(median(f("bytes")) / 1024).toFixed(1),
    chunks: median(f("chunks")),
    suspense: median(f("suspenseBoundaries")),
    n: runs.length,
  };
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`load before ${result.loadBefore} after ${result.loadAfter}`);
console.table(result.summary);

// Polls a URL every 20 ms and reports outage windows (consecutive failures / timeouts). Stops on SIGTERM and prints a JSON summary.
const url = process.argv[2];
const out = process.argv[3];
let ok = 0, fail = 0, downSince = null; const outages = []; const slow = []; let stop = false;
process.on("SIGTERM", () => { stop = true; });
while (!stop) {
  const t = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(500), headers: { connection: "close" } });
    await r.arrayBuffer();
    const dt = performance.now() - t;
    if (r.status === 200) { ok++; if (downSince !== null) { outages.push(Math.round(t - downSince)); downSince = null; } if (dt > 200) slow.push(Math.round(dt)); }
    else { fail++; downSince ??= t; }
  } catch { fail++; downSince ??= t; }
  await new Promise((r) => setTimeout(r, 20));
}
(await import("node:fs")).writeFileSync(out, JSON.stringify({ ok, fail, outagesMs: outages, slowOver200ms: slow }));

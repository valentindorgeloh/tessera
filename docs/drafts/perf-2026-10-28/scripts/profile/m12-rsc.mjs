// M12b: RSC payload bytes of (1) the sidebar navigation /inbox -> list and (2) a peek push / change / close. usage: node m12-rsc.mjs
import fs from "node:fs"; import zlib from "node:zlib";
import { chromium } from "playwright";
import { SETS, RES, load } from "./common.mjs";
const b = await chromium.launch();
const out = { load: load(), runs: [] };
for (const set of ["small", "large"]) {
  const { port, project } = SETS[set];
  const P = `/projects/${project}`;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send("Network.enable");
  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (e) => { const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v])); if (!("rsc" in h) && !e.request.url.includes("_rsc=")) return; reqs.set(e.requestId, { id: e.requestId, url: e.request.url.replace(/^http:\/\/127.0.0.1:\d+/, ""), prefetch: ("next-router-prefetch" in h) || ("next-router-segment-prefetch" in h), seg: h["next-router-segment-prefetch"] ?? null, ts: e.timestamp, t: Date.now() }); });
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (!r) return; r.done = true; r.enc = e.encodedDataLength; r.ms = Math.round((e.timestamp - r.ts) * 1000); });
  page.on("response", async (resp) => { const rq = resp.request(); const h = rq.headers(); if (!("rsc" in h) && !rq.url().includes("_rsc=")) return; try { const buf = await resp.body(); const u = rq.url().replace(/^http:\/\/127.0.0.1:\d+/, ""); const r = [...reqs.values()].reverse().find((x) => x.url === u && x.bytes == null); if (r) { r.bytes = buf.length; r.gz = zlib.gzipSync(buf).length; r.lines = buf.toString().split("\n").length; } } catch (err) {} });
  cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) r.failed = e.errorText + (e.canceled ? " canceled" : ""); });
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.fromCache = e.response.fromDiskCache || e.response.fromServiceWorker || false; } });
  const fill = async () => { for (const r of reqs.values()) { if (r.bytes != null || !r.done) continue; try { const bd = await cdp.send("Network.getResponseBody", { requestId: r.id }); const buf = bd.base64Encoded ? Buffer.from(bd.body, "base64") : Buffer.from(bd.body); r.bytes = buf.length; r.gz = zlib.gzipSync(buf).length; r.lines = bd.body.split("\n").length; } catch (err) { r.err = String(err).slice(0, 80); } } };
  await page.goto(`http://127.0.0.1:${port}/inbox`, { waitUntil: "networkidle" }); await page.waitForTimeout(3000);
  const mark = () => reqs.size && [...reqs.keys()].length;
  const take = async (label, fn) => { await page.waitForTimeout(1500); const before = new Set(reqs.keys()); const t0 = Date.now(); await fn(); await page.waitForTimeout(set === "large" ? 6000 : 2500); await fill(); const rs = [...reqs.entries()].filter(([id]) => !before.has(id)).map(([, r]) => r).filter((r) => r.t >= t0); out.runs.push({ set, label, requests: rs.map(({ ts, t, id, ...r }) => r) }); console.log(set, label, JSON.stringify(rs.map((r) => ({ u: r.url.slice(0, 90), pre: r.prefetch, seg: r.seg, bytes: r.bytes, gz: r.gz, enc: r.enc })))); };
  await take("nav inbox -> list (click sidebar)", async () => { await page.locator(`a[href="${P}/work-items"]`).filter({ visible: true }).first().click(); await page.waitForSelector("[data-list-ready]"); });
  await page.waitForTimeout(2000);
  const keys = page.locator(".tessera-wi-open");
  await take("peek open (row 1 key)", async () => { await keys.nth(1).click(); await page.waitForURL(/peek=/); });
  await take("peek switch (row 4 key)", async () => { await keys.nth(4).click({ force: true }); await page.waitForTimeout(300); });
  await take("peek close (Escape)", async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(300); });
  await ctx.close();
}
fs.writeFileSync(`${RES}/profile-m12-rsc-run${process.env.RUN ?? 0}.json`, JSON.stringify(out, null, 1));
await b.close();

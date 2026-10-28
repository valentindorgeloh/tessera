// M12a: split the list/table HTML into SSR markup and RSC flight data (__next_f scripts). usage: node m12-html.mjs
import fs from "node:fs"; import zlib from "node:zlib";
import { SETS, RES, layoutPath, load } from "./common.mjs";
const out = { load: load(), rows: [] };
for (const set of ["small", "large"]) {
  for (const [name, layout, group] of [["list", "list", null], ["list-state", "list", "state"], ["table", "table", null], ["board-state", "board", "state"]]) {
    const url = `http://127.0.0.1:${SETS[set].port}${layoutPath(set, layout, group)}`;
    const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
    const html = await res.text();
    const gz = zlib.gzipSync(html).length;
    // flight chunks: <script>self.__next_f.push([...])</script>
    let flight = 0, flightScripts = 0, other = 0, inlineScript = 0;
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g; let m; let scriptsTotal = 0; const flightTexts = [];
    while ((m = re.exec(html))) {
      scriptsTotal += m[0].length;
      if (m[1].includes("__next_f")) { flight += m[0].length; flightScripts++; flightTexts.push(m[1]); } else inlineScript += m[0].length;
    }
    const markup = html.length - scriptsTotal;
    const flightGz = zlib.gzipSync(flightTexts.join("\n")).length;
    const markupGz = zlib.gzipSync(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")).length;
    const rows = (html.match(/tessera-wi-row/g) || []).length;
    out.rows.push({ set, name, status: res.status, htmlBytes: html.length, htmlGz: gz, ssrMarkupBytes: markup, ssrMarkupGz: markupGz, flightScriptBytes: flight, flightScripts, flightGz, otherInlineScriptBytes: inlineScript, rowClassMentions: rows, domElementsApprox: (html.match(/<[a-zA-Z]/g) || []).length });
    console.log(set, name, JSON.stringify(out.rows.at(-1)));
  }
}
fs.writeFileSync(`${RES}/profile-m12-html.json`, JSON.stringify(out, null, 1));

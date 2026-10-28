// LANE-ROWS: pixel diff of same-named screenshots in two directories (HEAD vs lane). A pixel differs when any channel
// differs by more than 24. Usage: node lane-rows-pixdiff.mjs <dirA> <dirB> <out.json>
import fs from "node:fs";
import sharp from "sharp";
const [a, b, out] = process.argv.slice(2);
const rows = [];
for (const f of fs.readdirSync(a).filter((n) => n.endsWith(".png")).sort()) {
  if (!fs.existsSync(`${b}/${f}`)) { rows.push({ f, missing: true }); continue; }
  const [x, y] = await Promise.all([sharp(`${a}/${f}`).raw().toBuffer({ resolveWithObject: true }), sharp(`${b}/${f}`).raw().toBuffer({ resolveWithObject: true })]);
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) { rows.push({ f, size: [x.info.width, x.info.height, y.info.width, y.info.height] }); continue; }
  const ch = x.info.channels, W = x.info.width;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < x.data.length; i += ch) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.data[i + c] - y.data[i + c]));
    if (d > 24) {
      n++;
      const p = i / ch, px = p % W, py = Math.floor(p / W);
      if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py;
    }
  }
  rows.push({ f, diffPixels: n, bbox: n ? [x0, y0, x1, y1] : null });
}
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
const changed = rows.filter((r) => r.missing || r.size || r.diffPixels > 0);
console.log(JSON.stringify({ compared: rows.length, identical: rows.length - changed.length, changed }, null, 1));

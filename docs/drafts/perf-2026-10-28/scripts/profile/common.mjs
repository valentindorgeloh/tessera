import { execSync } from "node:child_process";
export const S = "/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf";
export const RES = `${S}/bc/results`;
export const SETS = {
  large: { port: 3824, project: "01a16ad8-6ddd-7752-91fa-653ae8b8a394", item: "01a16ad8-6e4b-75e0-a1b9-93396ad2e9a6" },
  small: { port: 3825, project: "01a160df-642f-7102-859a-8c50a72e7f1e", item: "01a160df-6440-736b-a03e-3ac1380b7a52" },
};
export const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
export function layoutPath(set, layout, group) {
  const P = `/projects/${SETS[set].project}/work-items`;
  if (layout === "list" && !group) return P;
  const d = { layout }; if (group) d.group_by = group;
  return `${P}?q=${q(d)}`;
}
export const load = () => execSync("uptime").toString().trim().replace(/.*load averages?: /, "");
export const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export const pct = (xs, p) => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; return a[Math.max(0, Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1))]; };

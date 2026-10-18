/**
 * Static bundle gate (decision 125): server-only names must never reach the
 * browser. `scanBundle` walks a directory (`.next/static` after `next build`)
 * and reports every forbidden string it finds. The CLI is scripts/check-bundle.ts.
 */
import fs from "node:fs";
import path from "node:path";

/** Strings that fail the gate (decision 125): secrets, the SQLite driver, the database path and the engine's server-only marker. */
export const FORBIDDEN = ["ANTHROPIC", "sk-ant-", "better-sqlite3", "drizzle-orm/better-sqlite3", "TESSERA_DB_PATH", "server-only"] as const;

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".mp3", ".wasm"]);
const CONTEXT = 30;

export type BundleFinding = { file: string; needle: string; count: number; context: string };

/** Findings for one file's text. No phrase is exempt: client copy must not spell a forbidden string. */
export function scanText(file: string, text: string): BundleFinding[] {
  const findings: BundleFinding[] = [];
  for (const needle of FORBIDDEN) {
    let count = 0;
    let first = -1;
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      count += 1;
      if (first === -1) first = at;
    }
    if (count > 0) {
      const context = text.slice(Math.max(0, first - CONTEXT), first + needle.length + CONTEXT).replace(/\s+/g, " ");
      findings.push({ file, needle, count, context });
    }
  }
  return findings;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

/** Every finding under `root`, file paths relative to it; throws when `root` is not a directory. */
export function scanBundle(root: string): { files: number; findings: BundleFinding[] } {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
  const files: string[] = [];
  walk(root, files);
  files.sort();
  const findings = files.flatMap((file) => scanText(path.relative(root, file), fs.readFileSync(file, "utf8")));
  return { files: files.length, findings };
}

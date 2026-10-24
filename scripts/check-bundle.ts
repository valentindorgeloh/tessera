/**
 * `npm run check:bundle [-- <dir>]` (decision 125): fails when the browser
 * bundle contains a server-only string. Run it after `next build`; it reads
 * `.next/static` (or <dir>) and never builds anything itself. Exit codes: 0
 * clean, 1 findings, 2 the directory is missing (build first).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN, scanBundle } from "./bundle-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = ".next/static";

function main(): number {
  const dir = path.resolve(REPO_ROOT, process.argv[2] ?? DEFAULT_DIR);
  if (!fs.existsSync(dir)) {
    console.error(`${dir} does not exist. Run \`npm run build\` first (a build writes .next; dev uses .next/dev).`);
    return 2;
  }
  const { files, findings } = scanBundle(dir);
  if (findings.length === 0) {
    console.log(`Bundle check passed: ${files} files in ${path.relative(REPO_ROOT, dir) || dir} contain none of ${FORBIDDEN.join(", ")}.`);
    return 0;
  }
  console.error(`Bundle check failed: server-only strings in the browser bundle (${path.relative(REPO_ROOT, dir) || dir}):`);
  for (const finding of findings) console.error(`  ${finding.file}: ${finding.needle} x${finding.count}  ...${finding.context}...`);
  console.error("No phrase is exempt: reword client copy so it does not spell a forbidden string (e.g. write \"the Anthropic API key\", not the variable name).");
  return 1;
}

process.exitCode = main();

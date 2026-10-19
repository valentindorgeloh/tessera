/**
 * Convention gate (plan §10). Fails the merge when Tessera code breaks a rule
 * that neither tsc nor eslint can see. Scope: src/, scripts/, tests/.
 *
 * Rules
 *  client-boundary      'use client' files import only @/lib/tessera/{types,schemas,core/keys,core/time,core/group,core/csv}
 *                       and never better-sqlite3, drizzle-orm or server-only
 *  component-boundary   src/components/** never imports @/lib/tessera/server, @/lib/tessera/db, better-sqlite3, drizzle-orm
 *  server-only          within src/lib/tessera/** only server.ts may import "server-only"
 *  forbidden-package    no xstyle, @heroicons, lucide-react, @stylexjs, @milkdown in Tessera code
 *  hex-colour           no hex colours outside src/themes/** (tokens only); append `hex-ok` to a line to opt out
 *  drizzle-zod          drizzle-zod is imported only under src/lib/tessera/db/schema/
 *  ai-boundary          @anthropic-ai/sdk is imported only by src/lib/tessera/ai/** and src/lib/tessera/tools/anthropic.ts
 *                       (tests/ may import it for fakes); src/components/** and 'use client' files never import @/lib/tessera/ai
 *  plane-marker         no identifiers or strings copied from the Plane code base
 *  no-router-refresh    mutations use Server Actions + refresh(); never router.refresh()
 *  no-cwd-in-engine     src/lib/tessera/** resolves paths from the module location, never process.cwd()
 *  decision-ref         a comment in src/** or scripts/** that cites `decision N` or `decision UN` names a row of the
 *                       "Resolved design decisions" tables in docs/PLAN.md (parsed from the file)
 *  css-token            every var(--x) in the css, ts and tsx files of src, of an Astryx token family (--spacing-, --color-, ...) resolves in the
 *                       installed @astryxdesign/core CSS or in our own CSS/theme/style props; a --tessera-* name must be
 *                       defined in the same file, or (CSS use) set by a style prop in a ts/tsx file, or (ts use) defined in a CSS file
 *  file-budget          .ts/.tsx files under src/ and scripts/ (tests excluded) stay within 600 lines; the ones already
 *                       over are pinned in scripts/file-budget.json and may shrink but not grow
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  countLines,
  definedTokens,
  evaluateFileBudget,
  parseDecisionNumbers,
  tokenUses,
  undefinedTokenUses,
  unknownDecisionRefs,
  visibleOurTokens,
} from "./convention-rules";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "scripts", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".js", ".mjs"]);
/** The gate scripts mention the rule text they enforce; exempt them from the text-based rules. */
const GATE_SCRIPTS = new Set(["scripts/check-conventions.ts", "scripts/check-licenses.ts"]);

const CLIENT_ALLOWED_TESSERA_IMPORTS = new Set([
  "@/lib/tessera/types",
  "@/lib/tessera/schemas",
  "@/lib/tessera/core/keys",
  "@/lib/tessera/core/time",
  "@/lib/tessera/core/group",
  "@/lib/tessera/core/csv",
]);

const BUDGET_FILE = "scripts/file-budget.json";
const DECISION_SCAN_DIRS = ["src/", "scripts/"];

/** Where the Anthropic SDK may be imported (P5 ai-boundary): the AI engine folder and its tool adapter. */
const ANTHROPIC_SDK = "@anthropic-ai/sdk";
const ANTHROPIC_SDK_ALLOWED_PREFIXES = ["src/lib/tessera/ai/"];
const ANTHROPIC_SDK_ALLOWED_FILES = new Set(["src/lib/tessera/tools/anthropic.ts"]);

const SERVER_ONLY_PACKAGES = ["better-sqlite3", "drizzle-orm", "server-only"];
const FORBIDDEN_PACKAGES = ["xstyle", "@heroicons/", "lucide-react", "@stylexjs/", "@milkdown/"];
const PLANE_MARKERS = ["makeplane", "plane.so", "@plane/", "apiserver", "useIssueStore", "TIssue", "IssueService", "AGPL"];

type Finding = { file: string; line: number; rule: string; message: string };
const findings: Finding[] = [];

function report(file: string, line: number, rule: string, message: string) {
  findings.push({ file, line, rule, message });
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

function imports(line: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1]);
  return out;
}

function hasUseClientDirective(lines: string[]): boolean {
  for (const raw of lines.slice(0, 10)) {
    const l = raw.trim();
    if (l === "" || l.startsWith("//") || l.startsWith("/*") || l.startsWith("*")) continue;
    return /^["']use client["'];?$/.test(l);
  }
  return false;
}

const HEX_RE = /(?<![\w&;%])#[0-9a-fA-F]{3,8}\b/;

const knownDecisions = parseDecisionNumbers(fs.readFileSync(path.join(ROOT, "docs/PLAN.md"), "utf8"));
const budgetCounts: Record<string, number> = {};
const tokenFiles: { rel: string; text: string; lang: "css" | "ts" }[] = [];

for (const dir of SCAN_DIRS) {
  for (const abs of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const isGenerated = rel.endsWith(".generated.ts") || rel.endsWith(".d.ts");
    const inEngine = rel.startsWith("src/lib/tessera/");
    const inComponents = rel.startsWith("src/components/");
    const inThemes = rel.startsWith("src/themes/");
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split("\n");
    const isClient = hasUseClientDirective(lines);
    if (rel.startsWith("src/") && EXTENSIONS.has(path.extname(rel))) tokenFiles.push({ rel, text, lang: rel.endsWith(".css") ? "css" : "ts" });
    const isSource = /\.tsx?$/.test(rel) && DECISION_SCAN_DIRS.some((d) => rel.startsWith(d));

    if (isSource) {
      for (const ref of unknownDecisionRefs(lines, knownDecisions)) {
        report(rel, ref.line, "decision-ref", `decision ${ref.number} is not in the "Resolved design decisions" tables of docs/PLAN.md`);
      }
      if (!/\.(test|d)\.tsx?$/.test(rel)) budgetCounts[rel] = countLines(text);
    }

    lines.forEach((line, i) => {
      const n = i + 1;
      const specs = imports(line);

      for (const spec of specs) {
        if (isClient && spec.startsWith("@/lib/tessera") && !CLIENT_ALLOWED_TESSERA_IMPORTS.has(spec)) {
          report(rel, n, "client-boundary", `client file imports ${spec}; allowed: ${[...CLIENT_ALLOWED_TESSERA_IMPORTS].join(", ")}`);
        }
        if (isClient && SERVER_ONLY_PACKAGES.some((p) => spec === p || spec.startsWith(p + "/"))) {
          report(rel, n, "client-boundary", `client file imports server-side package ${spec}`);
        }
        if (
          inComponents &&
          (spec === "@/lib/tessera/server" || spec.startsWith("@/lib/tessera/db") || SERVER_ONLY_PACKAGES.slice(0, 2).some((p) => spec === p || spec.startsWith(p + "/")))
        ) {
          report(rel, n, "component-boundary", `components must not import ${spec}`);
        }
        if (inEngine && spec === "server-only" && rel !== "src/lib/tessera/server.ts") {
          report(rel, n, "server-only", "only src/lib/tessera/server.ts may import server-only (Vitest and tsx load the rest)");
        }
        if (FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(p))) {
          report(rel, n, "forbidden-package", `import of ${spec} is not allowed in Tessera code`);
        }
        if (
          (spec === ANTHROPIC_SDK || spec.startsWith(ANTHROPIC_SDK + "/")) &&
          !rel.startsWith("tests/") &&
          !ANTHROPIC_SDK_ALLOWED_FILES.has(rel) &&
          !ANTHROPIC_SDK_ALLOWED_PREFIXES.some((p) => rel.startsWith(p))
        ) {
          report(rel, n, "ai-boundary", `${ANTHROPIC_SDK} may only be imported by src/lib/tessera/ai/** and src/lib/tessera/tools/anthropic.ts`);
        }
        if ((inComponents || isClient) && (spec === "@/lib/tessera/ai" || spec.startsWith("@/lib/tessera/ai/"))) {
          report(rel, n, "ai-boundary", `components and "use client" files must not import ${spec}; use @/lib/tessera/{types,schemas} for AI shapes`);
        }
        if (spec === "drizzle-zod" && !rel.startsWith("src/lib/tessera/db/schema/")) {
          report(rel, n, "drizzle-zod", "drizzle-zod may only be used inside src/lib/tessera/db/schema/");
        }
      }

      if (!isGenerated && !inThemes && !line.includes("hex-ok") && !line.startsWith("#!") && HEX_RE.test(line)) {
        report(rel, n, "hex-colour", "hex colour literal; use var(--color-*) tokens or a palette key (append `hex-ok` if this is not a colour)");
      }

      if (!GATE_SCRIPTS.has(rel)) {
        for (const marker of PLANE_MARKERS) {
          if (line.includes(marker)) report(rel, n, "plane-marker", `contains "${marker}"; Tessera must not carry Plane identifiers or strings`);
        }
      }

      if (!GATE_SCRIPTS.has(rel) && /\brouter\.refresh\s*\(/.test(line)) {
        report(rel, n, "no-router-refresh", "use a Server Action that calls refresh() instead of router.refresh()");
      }

      if (inEngine && /\bprocess\.cwd\s*\(/.test(line)) {
        report(rel, n, "no-cwd-in-engine", "resolve against the repo root from the module location, never process.cwd()");
      }
    });
  }
}

/** Every .css under the installed Astryx package (astryx.css, reset.css, ...). */
function astryxCssFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return astryxCssFiles(full);
    return e.name.endsWith(".css") ? [full] : [];
  });
}

const astryxTokens = new Set<string>();
for (const file of astryxCssFiles(path.join(ROOT, "node_modules/@astryxdesign/core/dist"))) {
  for (const name of definedTokens(fs.readFileSync(file, "utf8"), "css")) astryxTokens.add(name);
}
const ourTokens = new Set<string>();
const tokensByFile = new Map<string, Set<string>>();
const cssDefined = new Set<string>();
const tsDefined = new Set<string>();
for (const f of tokenFiles) {
  const names = definedTokens(f.text, f.lang);
  tokensByFile.set(f.rel, names);
  for (const name of names) {
    ourTokens.add(name);
    (f.lang === "css" ? cssDefined : tsDefined).add(name);
  }
}
if (astryxTokens.size === 0) report("node_modules/@astryxdesign/core/dist", 1, "css-token", "found no Astryx tokens; is @astryxdesign/core installed?");
for (const f of tokenFiles) {
  const visible = visibleOurTokens(f.lang, tokensByFile.get(f.rel) ?? new Set(), ourTokens, cssDefined, tsDefined);
  for (const hit of undefinedTokenUses(tokenUses(f.text, f.lang), astryxTokens, visible)) report(f.rel, hit.line, "css-token", hit.message);
}

const budget: Record<string, number> = JSON.parse(fs.readFileSync(path.join(ROOT, BUDGET_FILE), "utf8"));
const budgetResult = evaluateFileBudget(budgetCounts, budget, new Set());
for (const f of budgetResult.failures) report(f.file, 1, "file-budget", f.message);

if (findings.length > 0) {
  console.error(`\nConvention gate failed: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
  console.error("");
  process.exit(1);
}
for (const note of budgetResult.notes) console.log(`note: ${note}`);
if (budgetResult.exempt.length > 0) console.log(`File budget: over the limit and exempt: ${budgetResult.exempt.join(", ")}`);
console.log("Convention gate passed.");

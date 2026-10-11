/**
 * Convention gate (plan §10). Fails the merge when Tessera code breaks a rule
 * that neither tsc nor eslint can see. Scope: src/, scripts/, tests/.
 *
 * Legacy handbook files (deleted in P6) are exempt from the Tessera-only rules
 * so the old routes keep working until then. The exception is hex-colour: the
 * legacy files share the app theme, so only src/app/page.module.css (dead CSS)
 * keeps its hex literals.
 *
 * Rules
 *  client-boundary      'use client' files import only @/lib/tessera/{types,schemas,core/keys,core/time,core/group}
 *                       and never better-sqlite3, drizzle-orm or server-only
 *  component-boundary   src/components/** never imports @/lib/tessera/server, @/lib/tessera/db, better-sqlite3, drizzle-orm
 *  server-only          within src/lib/tessera/** only server.ts may import "server-only"
 *  forbidden-package    no xstyle, @heroicons, lucide-react, @stylexjs, @milkdown in Tessera code
 *  hex-colour           no hex colours outside src/themes/** (tokens only); append `hex-ok` to a line to opt out
 *  drizzle-zod          drizzle-zod is imported only by src/lib/tessera/db/schema.ts
 *  plane-marker         no identifiers or strings copied from the Plane code base
 *  no-router-refresh    mutations use Server Actions + refresh(); never router.refresh()
 *  no-cwd-in-engine     src/lib/tessera/** resolves paths from the module location, never process.cwd()
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "scripts", "tests"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".js", ".mjs"]);
/** The gate scripts mention the rule text they enforce; exempt them from the text-based rules. */
const GATE_SCRIPTS = new Set(["scripts/check-conventions.ts", "scripts/check-licenses.ts"]);

/** Files of the handbook app that existed before Tessera (baseline commit). Removed in P6. */
const LEGACY_HANDBOOK_FILES = new Set([
  "src/app/actions.ts",
  "src/app/api/mcp/route.ts",
  "src/app/document-editor.tsx",
  "src/app/document-table.tsx",
  "src/app/globals.css",
  "src/app/item-screen.tsx",
  "src/app/(handbook)/items/[id]/page.tsx",
  "src/app/(handbook)/layout.tsx",
  "src/app/(handbook)/page.tsx",
  "src/app/layout.tsx",
  "src/app/page-body.tsx",
  "src/app/page-column.tsx",
  "src/app/page-outline.tsx",
  "src/app/page-tabs.tsx",
  "src/app/page.module.css",
  "src/app/providers.tsx",
  "src/app/search-dialog.tsx",
  "src/app/workspace-frame.tsx",
  "src/app/workspace-screen.tsx",
  "src/app/workspace-shell.tsx",
  "src/lib/workspace-model.ts",
  "src/lib/workspace.ts",
]);

/**
 * Legacy files that may keep hex colours. The others share the Tessera theme
 * (globals.css, providers.tsx, layout.tsx), so the hex rule covers them too.
 */
const HEX_EXEMPT_LEGACY = new Set(["src/app/page.module.css"]);

const CLIENT_ALLOWED_TESSERA_IMPORTS = new Set([
  "@/lib/tessera/types",
  "@/lib/tessera/schemas",
  "@/lib/tessera/core/keys",
  "@/lib/tessera/core/time",
  "@/lib/tessera/core/group",
]);

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

for (const dir of SCAN_DIRS) {
  for (const abs of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const isLegacy = LEGACY_HANDBOOK_FILES.has(rel) || rel.startsWith("src/app/items/");
    const isGenerated = rel.endsWith(".generated.ts") || rel.endsWith(".d.ts");
    const inEngine = rel.startsWith("src/lib/tessera/");
    const inComponents = rel.startsWith("src/components/");
    const inThemes = rel.startsWith("src/themes/");
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split("\n");
    const isClient = hasUseClientDirective(lines);

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
        if (!isLegacy && FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(p))) {
          report(rel, n, "forbidden-package", `import of ${spec} is not allowed in Tessera code`);
        }
        if (spec === "drizzle-zod" && rel !== "src/lib/tessera/db/schema.ts") {
          report(rel, n, "drizzle-zod", "drizzle-zod may only be used inside src/lib/tessera/db/schema.ts");
        }
      }

      if ((!isLegacy || !HEX_EXEMPT_LEGACY.has(rel)) && !isGenerated && !inThemes && !line.includes("hex-ok") && !line.startsWith("#!") && HEX_RE.test(line)) {
        report(rel, n, "hex-colour", "hex colour literal; use var(--color-*) tokens or a palette key (append `hex-ok` if this is not a colour)");
      }

      if (!isLegacy && !GATE_SCRIPTS.has(rel)) {
        for (const marker of PLANE_MARKERS) {
          if (line.includes(marker)) report(rel, n, "plane-marker", `contains "${marker}"; Tessera must not carry Plane identifiers or strings`);
        }
      }

      if (!isLegacy && !GATE_SCRIPTS.has(rel) && /\brouter\.refresh\s*\(/.test(line)) {
        report(rel, n, "no-router-refresh", "use a Server Action that calls refresh() instead of router.refresh()");
      }

      if (inEngine && /\bprocess\.cwd\s*\(/.test(line)) {
        report(rel, n, "no-cwd-in-engine", "resolve against the repo root from the module location, never process.cwd()");
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`\nConvention gate failed: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
  console.error("");
  process.exit(1);
}
console.log("Convention gate passed.");

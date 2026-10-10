/**
 * Licence gate (plan decision U6).
 *
 * Walks node_modules (nested and scoped) and fails when any installed package
 * carries a licence outside the allowlist, or no licence at all, unless the
 * package is listed in licenses.exceptions.json with a reason.
 *
 * Rejected on purpose: anything that would force us to publish our source
 * (GPL, AGPL, LGPL, MPL, SSPL, BUSL, EUPL, OSL, CPAL, ...) or to show
 * attribution inside the product (CC-BY family, ODC-By, ...).
 *
 * SPDX expressions: "A OR B" passes when any side passes; "A AND B" passes
 * only when every side passes. Suffixes "-only" / "-or-later" and a trailing
 * "+" are stripped before matching.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const EXCEPTIONS_FILE = path.join(ROOT, "licenses.exceptions.json");

const ALLOW = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "Zlib",
]);

type ExceptionEntry = {
  package: string;
  /** Optional version prefix, e.g. "1." or "1.0.30001815". */
  version?: string;
  /** The licence string this exception was reviewed for; a change re-fails the gate. */
  license: string;
  scope: "dev-only" | "build-only" | "runtime-unused" | "mislabelled-spdx";
  reason: string;
};

type Pkg = { name: string; version: string; license: string; dir: string };

function readExceptions(): ExceptionEntry[] {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return [];
  const parsed = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, "utf8")) as { exceptions: ExceptionEntry[] };
  return parsed.exceptions ?? [];
}

function licenseOf(json: Record<string, unknown>): string {
  const lic = json.license;
  if (typeof lic === "string") return lic.trim();
  if (lic && typeof lic === "object" && typeof (lic as { type?: unknown }).type === "string") {
    return ((lic as { type: string }).type).trim();
  }
  const lics = json.licenses;
  if (Array.isArray(lics) && lics.length > 0) {
    const parts = lics
      .map((l) => (typeof l === "string" ? l : (l as { type?: string })?.type))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (parts.length > 0) return `(${parts.join(" OR ")})`;
  }
  return "";
}

function normalizeId(id: string): string {
  return id
    .trim()
    .replace(/^\(|\)$/g, "")
    .replace(/-only$/i, "")
    .replace(/-or-later$/i, "")
    .replace(/\+$/, "");
}

/** True when the SPDX expression is satisfiable with allowlisted licences only. */
function isAllowed(expr: string): boolean {
  const cleaned = expr.replace(/[()]/g, " ").trim();
  if (!cleaned) return false;
  return cleaned
    .split(/\s+OR\s+/i)
    .some((alt) => alt.split(/\s+AND\s+/i).every((id) => ALLOW.has(normalizeId(id))));
}

function* walk(dir: string): Generator<Pkg> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory()) yield* visit(path.join(full, scoped.name));
      }
    } else {
      yield* visit(full);
    }
  }
}

function* visit(pkgDir: string): Generator<Pkg> {
  const pj = path.join(pkgDir, "package.json");
  if (fs.existsSync(pj)) {
    try {
      const json = JSON.parse(fs.readFileSync(pj, "utf8")) as Record<string, unknown>;
      if (typeof json.name === "string") {
        yield {
          name: json.name,
          version: typeof json.version === "string" ? json.version : "",
          license: licenseOf(json),
          dir: path.relative(ROOT, pkgDir),
        };
      }
    } catch {
      // unreadable package.json: report as missing licence below
      yield { name: path.basename(pkgDir), version: "", license: "", dir: path.relative(ROOT, pkgDir) };
    }
  }
  yield* walk(path.join(pkgDir, "node_modules"));
}

function main(): number {
  const exceptions = readExceptions();
  const usedExceptions = new Set<number>();
  const failures: Pkg[] = [];
  let scanned = 0;
  const seen = new Set<string>();

  for (const pkg of walk(NODE_MODULES)) {
    scanned += 1;
    if (isAllowed(pkg.license)) continue;
    const idx = exceptions.findIndex(
      (e) =>
        e.package === pkg.name &&
        (!e.version || pkg.version.startsWith(e.version)) &&
        e.license.trim() === pkg.license.trim(),
    );
    if (idx >= 0) {
      usedExceptions.add(idx);
      continue;
    }
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push(pkg);
  }

  const unused = exceptions.filter((_, i) => !usedExceptions.has(i));
  for (const e of unused) {
    console.warn(`warning: unused licence exception for ${e.package} (${e.license})`);
  }

  if (failures.length > 0) {
    console.error(`\nLicence gate failed: ${failures.length} package(s) outside the allowlist\n`);
    for (const f of failures) {
      console.error(`  ${f.name}@${f.version || "?"}  licence="${f.license || "<missing>"}"  (${f.dir})`);
    }
    console.error(
      "\nAllowed: " + [...ALLOW].join(", ") +
        "\nEither replace the dependency or add a reviewed entry to licenses.exceptions.json.\n",
    );
    return 1;
  }

  console.log(`Licence gate passed: ${scanned} packages scanned, ${usedExceptions.size} reviewed exception(s) applied.`);
  return 0;
}

process.exit(main());

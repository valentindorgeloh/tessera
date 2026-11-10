import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Import boundary for the engine (docs/contracts/ui.md, "Import boundary").
// Server Components, Server Actions and route handlers read through
// `@/lib/tessera/server`; client code imports only `@/lib/tessera/types`,
// `@/lib/tessera/schemas` and `@/lib/tessera/core/{keys,time,group,csv}`.
// Whether a file is a "use client" file is checked by
// scripts/check-conventions.ts; `server-only` guards the server entry at
// bundle time. The patterns below are regexes (gitignore-style groups cannot
// allow a child of a blocked parent).
const databaseImports = [
  {
    regex: "^@/lib/tessera(/index|/db(/.*)?)?$",
    message:
      "Engine database modules and the engine barrel are server-only. Import from '@/lib/tessera/server' in Server Components, or use a Server Action.",
  },
  {
    regex: "^(better-sqlite3|drizzle-orm)(/.*)?$",
    message:
      "Database drivers are server-only. Import from '@/lib/tessera/server' in Server Components, or use a Server Action.",
  },
];

// Dialog and AlertDialog come from `@/components/shell/dialogs`, which closes
// the native <dialog> when Next hides a route (docs/contracts/ui.md, "Modal
// dialogs and hidden routes"). `importNames` leaves DialogHeader and the rest of
// Astryx free to import.
const dialogMessage =
  "Import Dialog and AlertDialog from '@/components/shell/dialogs': it closes the native <dialog> when a navigation hides the route, so the next page is not left inert.";
const dialogImports = [
  { name: "@astryxdesign/core/Dialog", importNames: ["Dialog"], message: dialogMessage },
  { name: "@astryxdesign/core/AlertDialog", importNames: ["AlertDialog"], message: dialogMessage },
  { name: "@astryxdesign/core", importNames: ["Dialog", "AlertDialog"], message: dialogMessage },
];

// Components may not reach the engine beyond its client-safe modules.
const componentPatterns = [
  ...databaseImports,
  {
    regex: "^@/lib/tessera(?!/(types|schemas|core/(keys|time|group|csv))$)",
    message:
      "Components may import only '@/lib/tessera/types', '@/lib/tessera/schemas' and '@/lib/tessera/core/{keys,time,group,csv}'. Read through a Server Component and write through a Server Action.",
  },
  {
    // The superagent control client reads the token file and the runner (decision 152): components get its types and constants only.
    regex: "^@/lib/superagent(?!/types$)",
    message:
      "Components may import only '@/lib/superagent/types'. The runner client and its token reading are server-only: read through the Superagent page and write through the Server Actions in '@/app/actions/superagent'.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/actions/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: dialogImports, patterns: databaseImports }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: dialogImports, patterns: componentPatterns }],
    },
  },
  {
    // The wrapper is the one place that imports Astryx's Dialog and AlertDialog.
    files: ["src/components/shell/dialogs.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: componentPatterns }],
    },
  },
  {
    // Astryx local theme descriptors (`astryx docs theme`) keep the CLI's canonical
    // `export default {…}` shape so `astryx upgrade` and `doctor` can read them.
    files: ["src/themes/**/*.doc.mjs"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  globalIgnores([
    ".next/**",
    // Builds in their own folder (decision 140: TESSERA_DIST_DIR, e.g. .next-probe or .next-build).
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "astryx/**",
    "drizzle/**",
    "data/**",
    // Agent worktrees (other branches, their own .next builds) live here.
    ".claude/**",
    // Archived measurement probes that a later round re-runs from a scratch copy; not product code.
    "docs/drafts/**",
  ]),
]);

export default eslintConfig;

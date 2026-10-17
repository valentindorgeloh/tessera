import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Import boundary for the engine (docs/contracts/ui.md, "Import boundary").
// Server Components, Server Actions and route handlers read through
// `@/lib/tessera/server`; client code imports only `@/lib/tessera/types`,
// `@/lib/tessera/schemas` and `@/lib/tessera/core/{keys,time,group}`.
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
    regex: "^@/lib/tessera(?!/(types|schemas|core/(keys|time|group))$)",
    message:
      "Components may import only '@/lib/tessera/types', '@/lib/tessera/schemas' and '@/lib/tessera/core/{keys,time,group}'. Read through a Server Component and write through a Server Action.",
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
  {
    // Legacy handbook files: kept to their old lint rules until they are removed in P6 (see docs/PLAN.md).
    files: [
      "src/app/page-body.tsx",
      "src/app/document-editor.tsx",
      "src/app/document-table.tsx",
      "src/app/page-tabs.tsx",
      "src/app/workspace-shell.tsx",
      "src/app/workspace-screen.tsx",
      "src/app/workspace-frame.tsx",
      "src/app/item-screen.tsx",
      "src/app/search-dialog.tsx",
      "src/app/page-column.tsx",
      "src/app/page-outline.tsx",
    ],
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "astryx/**",
    "drizzle/**",
    "data/**",
    // Agent worktrees (other branches, their own .next builds) live here.
    ".claude/**",
  ]),
]);

export default eslintConfig;

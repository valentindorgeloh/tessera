import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Server-only parts of the engine. Only the engine itself, Server Actions,
// route handlers, scripts and tests may import them. Client code imports
// `@/lib/tessera/types`, `@/lib/tessera/schemas` or `@/lib/tessera/core/*`.
const serverOnlyEngineImports = [
  "@/lib/tessera/db",
  "@/lib/tessera/db/*",
  "@/lib/tessera/server",
  "better-sqlite3",
  "drizzle-orm",
  "drizzle-orm/*",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/actions/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: serverOnlyEngineImports,
              message:
                "Engine database modules are server-only. Import from '@/lib/tessera/server' in Server Components, or use a Server Action.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...serverOnlyEngineImports, "@/lib/tessera", "@/lib/tessera/!(types|schemas|core)/**"],
              message:
                "Components may import only '@/lib/tessera/types', '@/lib/tessera/schemas' and '@/lib/tessera/core/*'.",
            },
          ],
        },
      ],
    },
  },
  {
    // Legacy handbook files: untouched until they are removed in P6 (see docs/PLAN.md).
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
  ]),
]);

export default eslintConfig;

import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Single source of truth for the schema is src/lib/tessera/db/schema/index.ts.
// Migrations are generated into ./drizzle and applied by the app (getDb) or `npm run db:migrate`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/tessera/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.resolve(process.env.TESSERA_DB_PATH ?? "data/tessera.db"),
  },
  strict: true,
  verbose: true,
});

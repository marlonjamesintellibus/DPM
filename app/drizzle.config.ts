import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes SQL migrations to ./drizzle from the schema.
// The app applies them at startup (src/db/client.ts), on PGlite or Postgres.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});

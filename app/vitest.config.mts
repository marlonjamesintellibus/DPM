import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Domain and database tests run in Node. Component tests opt in to jsdom with
// a `// @vitest-environment jsdom` comment at the top of the file.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Booting PGlite takes a few seconds when every worker does it at once; the defaults (5s, 10s)
    // made the full suite flaky under load
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});

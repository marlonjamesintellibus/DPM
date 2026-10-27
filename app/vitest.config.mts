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
  },
});

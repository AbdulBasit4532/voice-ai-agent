import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_PATH: ":memory:",
      LOG_LEVEL: "silent",
      VAPI_SERVER_SECRET: "test-secret",
    },
  },
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://rentanllm:rentanllm@localhost:54329/rentanllm",
  },
  dialect: "postgresql",
  schema: "./src/schema.ts",
});

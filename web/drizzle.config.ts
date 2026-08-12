import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // 生成にだけ使う。実際の接続は src/db/index.ts が決める。
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/personallink",
  },
  strict: true,
  verbose: true,
});

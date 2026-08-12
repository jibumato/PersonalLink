import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // PGlite の初回起動(WASM読み込み+マイグレーション)に余裕を持たせる
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // サーバー専用モジュールをテストから読むための差し替え(tests/server-only-stub.ts 参照)
      "server-only": resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});

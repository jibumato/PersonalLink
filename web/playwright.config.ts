import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests",
  // tests/unit は Vitest の担当。Playwright は *.spec.ts だけを見る
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 本番ビルドを起動して検証する(本番に近い経路でテストする)
    command: `npm run start -- --port ${PORT}`,
    // 本番ビルドで起動するため、開発用ログインは明示的に有効化する
    // (プレビュー環境と同じ条件。無効時の挙動は tests/unit/dev-auth.test.ts が守る)
    env: { PL_DEV_LOGIN: "enabled" },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

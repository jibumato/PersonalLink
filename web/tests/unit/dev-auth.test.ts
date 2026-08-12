import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 仮ログインが本番で有効にならないことを守る。
 *
 * ここが破れると **@ID を知っているだけで誰にでもなりすませる**。
 * 認証方式が決まって仮ログインを削除するまで、このテストは外さないこと。
 */
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const original = { ...process.env };
  Object.assign(process.env, env);
  const mod = await import("@/lib/dev-auth");
  const result = mod.devLoginEnabled();
  process.env = original;
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devLoginEnabled", () => {
  it("Vercel本番では、明示的に有効化されていても無効", async () => {
    expect(
      await loadWith({
        VERCEL_ENV: "production",
        NODE_ENV: "production",
        PL_DEV_LOGIN: "enabled",
      }),
    ).toBe(false);
  });

  it("Vercel本番では、開発ビルドであっても無効", async () => {
    expect(
      await loadWith({ VERCEL_ENV: "production", NODE_ENV: "development", PL_DEV_LOGIN: "enabled" }),
    ).toBe(false);
  });

  it("ローカル開発では有効", async () => {
    expect(
      await loadWith({ VERCEL_ENV: undefined, NODE_ENV: "development", PL_DEV_LOGIN: undefined }),
    ).toBe(true);
  });

  it("本番ビルドでは、明示指定がなければ無効", async () => {
    expect(
      await loadWith({ VERCEL_ENV: undefined, NODE_ENV: "production", PL_DEV_LOGIN: undefined }),
    ).toBe(false);
  });

  it("プレビュー(本番ビルド)は明示指定でのみ有効", async () => {
    expect(
      await loadWith({ VERCEL_ENV: "preview", NODE_ENV: "production", PL_DEV_LOGIN: "enabled" }),
    ).toBe(true);
    expect(
      await loadWith({ VERCEL_ENV: "preview", NODE_ENV: "production", PL_DEV_LOGIN: "1" }),
    ).toBe(false);
  });
});

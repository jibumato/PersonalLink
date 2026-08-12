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

/**
 * 開発用の時計送り(E2Eのためだけの裏口)。
 *
 * ここが本番で開いていると、**他人の接続の期限を書き換えられる**。
 * 仮ログインと同じ判定を使っているが、判定を通していること自体をテストで固定する。
 */
describe("/api/dev/clock", () => {
  async function post(env: Record<string, string | undefined>) {
    vi.resetModules();
    const original = { ...process.env };
    Object.assign(process.env, env);
    const { POST } = await import("@/app/api/dev/clock/route");
    const res = await POST(
      new Request("http://localhost/api/dev/clock", {
        method: "POST",
        body: JSON.stringify({ connectionId: "x", expiresInHours: -1, graceInHours: -1 }),
      }),
    );
    process.env = original;
    return res.status;
  }

  it("Vercel本番では存在しない(404)", async () => {
    expect(
      await post({ VERCEL_ENV: "production", NODE_ENV: "production", PL_DEV_LOGIN: "enabled" }),
    ).toBe(404);
  });

  it("本番ビルドで明示指定がなければ存在しない(404)", async () => {
    expect(
      await post({ VERCEL_ENV: undefined, NODE_ENV: "production", PL_DEV_LOGIN: undefined }),
    ).toBe(404);
  });
});

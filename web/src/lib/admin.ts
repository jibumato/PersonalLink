import "server-only";

/**
 * ダッシュボード(KPI)の閲覧権限。
 *
 * 集計値しか出さないとはいえ事業の数字なので、誰でも見られる場所には置かない。
 *
 *   1. `PL_ADMIN_HANDLES` が設定されていれば、**そこに載っている @ID だけ**(環境を問わず)
 *   2. 設定が無いときは、**本番では誰も見られない**。ローカル・プレビューでは開く
 *
 * 設定漏れが「全開放」にならない向きにしてある。
 * 本番判定に `VERCEL_ENV` を使うのは仮ログイン([dev-auth.ts](./dev-auth.ts))と同じ理由で、
 * 本番ビルドで動かしているだけのプレビューやE2Eを本番と混同しないため。
 */
export function canViewDashboard(handle: string | null): boolean {
  const allowed = (process.env.PL_ADMIN_HANDLES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length > 0) {
    return handle !== null && allowed.includes(handle.toLowerCase());
  }
  return process.env.VERCEL_ENV !== "production";
}

/**
 * 開発用の仮ログイン。
 *
 * 認証方式が未定([D-7](../../../docs/01-screen-design.md))の間、
 * S2以降(QR接続・チャット・期限エンジン)の開発を止めないための踏み台。
 * 方式が決まったら本物の本人確認に差し替え、このファイルは削除する。
 *
 * ⚠️ **本番では絶対に有効にしない。** @ID を入れるだけで誰にでもなりすませるため。
 * 多層で防ぐ:
 *   1. `VERCEL_ENV === "production"` なら問答無用で無効
 *   2. ローカル・テスト(NODE_ENV !== production)では有効
 *   3. プレビュー等の本番ビルドでは `PL_DEV_LOGIN=enabled` の明示指定が必要
 */
export function devLoginEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.PL_DEV_LOGIN === "enabled";
}

/** 仮ログインが無効なのに使われた場合に投げる。 */
export class DevLoginDisabledError extends Error {
  constructor() {
    super("開発用ログインは無効です");
    this.name = "DevLoginDisabledError";
  }
}

export function assertDevLoginEnabled() {
  if (!devLoginEnabled()) throw new DevLoginDisabledError();
}

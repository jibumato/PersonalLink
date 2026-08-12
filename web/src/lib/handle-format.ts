/**
 * Universal ID(@handle)の**形式**検証。
 *
 * DBに触れない純粋関数だけを置く。クライアント(入力欄のリアルタイム表示)と
 * サーバー(最終判定)の**両方から同じ規則を使う**ため、ここを分けている。
 * DBを見る可用性チェックは [handle.ts](./handle.ts)(サーバー専用)。
 *
 * 仕様: [A-2](../../../docs/01-screen-design.md)
 */

/**
 * 使わせない handle。
 * なりすまし(公式を装う)と、将来のURLパスとの衝突を防ぐ。
 */
export const RESERVED_HANDLES = new Set([
  // 運営・公式を装うもの
  "admin", "administrator", "root", "official", "staff", "support", "help",
  "system", "security", "moderator", "mod", "personallink", "team", "info",
  "contact", "billing", "abuse", "noreply", "postmaster", "webmaster",
  // URLパスとして使う/使いうるもの
  "api", "www", "app", "auth", "login", "logout", "signup", "signin",
  "settings", "home", "qr", "connect", "c", "g", "groups", "me", "new",
  "about", "terms", "privacy", "legal", "docs", "blog", "status", "health",
  "dev", "welcome", "profile",
  // 紛らわしいもの
  "null", "undefined", "none", "anonymous", "deleted", "unknown", "test",
]);

export type HandleRejection =
  | "empty"
  | "non_ascii"
  | "invalid_chars"
  | "too_short"
  | "too_long"
  | "reserved"
  | "taken"
  | "held";

export type HandleCheck =
  | { ok: true }
  | { ok: false; reason: HandleRejection; message: string };

/**
 * 形式だけを検証する。
 *
 * 日本語入力(IME)対応のため、**全角が混ざった場合を専用のメッセージで返す**。
 * 「使えない文字です」だけでは、日本語キーボードのままだと気づけない(仕様書 A-2)。
 */
export function checkHandleFormat(raw: string): HandleCheck {
  const v = raw.trim();
  if (!v) return { ok: false, reason: "empty", message: "" };
  if (/[^\x20-\x7E]/.test(v)) {
    return {
      ok: false,
      reason: "non_ascii",
      message: "半角英数字で入力してください(日本語入力をオフに切り替えてください)",
    };
  }
  if (!/^[a-z0-9_]*$/.test(v)) {
    return { ok: false, reason: "invalid_chars", message: "使える文字は英小文字・数字・_ です" };
  }
  if (v.length < 3) {
    return { ok: false, reason: "too_short", message: `あと${3 - v.length}文字入力してください` };
  }
  if (v.length > 20) {
    return { ok: false, reason: "too_long", message: "20文字までです" };
  }
  if (RESERVED_HANDLES.has(v)) {
    return { ok: false, reason: "reserved", message: "このIDは使えません" };
  }
  return { ok: true };
}

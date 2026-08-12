import "server-only";

/**
 * 計測イベント(仕様書 §6 の KPI 計測設計)。
 *
 * **メッセージ本文・画像・個人が特定できる内容は絶対に含めない**(D-10 / 憲法第二条)。
 * 「入れないように気をつける」ではなく、**型で入れられないようにする**のがここの目的(T-9)。
 *
 * S2 は送出の骨組みだけ。集計基盤(テーブル or 外部)は S6 で決める。
 */

/** 計測に載せてよい値。文字列を自由に入れられないよう、意図的に狭くしている。 */
type MetaValue = number | boolean | null;

/** イベント名と、そのイベントが持てるメタデータ。 */
export type AnalyticsEvent =
  // B-2 マイQR表示 — QR接続率の分母
  | { name: "qr_displayed"; expiryDays: number }
  | { name: "qr_expiry_changed"; expiryDays: number }
  // B-3 読み取り
  | { name: "qr_scanned"; result: "ok" | "expired" | "invalid" | "consumed" | "self" | "already_connected" }
  | { name: "scan_requires_signup"; viaQr: true }
  // B-4 / B-5 — QR接続率の分子
  | { name: "connect_confirm_viewed"; expiryDays: number }
  | { name: "connection_established"; expiryDays: number; viaSignup: boolean };

/**
 * イベントを記録する。
 *
 * 現時点では構造化ログへ出すだけ。集計先が決まったらここだけ差し替える
 * (呼び出し側は変更不要)。
 */
export function track(event: AnalyticsEvent, extra?: Record<string, MetaValue>): void {
  const payload = { ...event, ...extra, at: new Date().toISOString() };
  // 本文を渡す経路が型として存在しないため、ここに本文が混ざることはない
  console.info("[analytics]", JSON.stringify(payload));
}

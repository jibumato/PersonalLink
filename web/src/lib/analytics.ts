import "server-only";

/**
 * 計測イベント(仕様書 §6 の KPI 計測設計)。
 *
 * **メッセージ本文・画像・個人が特定できる内容は絶対に含めない**(D-10 / 憲法第二条)。
 * 「入れないように気をつける」ではなく、**型で入れられないようにする**のがここの目的(T-9)。
 *
 * S2 は送出の骨組みだけ。集計基盤(テーブル or 外部)は S6 で決める。
 *
 * ⚠️ **誰の行動かを載せない。** userId も connectionId も型に無い。
 * 「継続しない」を選んだ事実が個人に紐づくと、D-3 の秘匿が計測経路から破れる。
 * ここで取るのは**匿名のカウンタ**だけ。
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
  | { name: "connection_established"; expiryDays: number; viaSignup: boolean }
  // D-2 継続確認 — **期限後継続率**の分母/分子(S4)
  | { name: "renewal_viewed"; inGrace: boolean; daysSinceConnect: number }
  | { name: "renewal_choice"; choice: "continue" | "end" }
  | { name: "connection_permanent"; daysSinceConnect: number }
  // D-3 終了
  | { name: "connection_expired"; daysSinceConnect: number }
  | { name: "expired_history_deleted"; daysSinceConnect: number }
  // C-2 / E-1 レベル(S5)
  | { name: "connection_info_viewed" }
  | { name: "level_proposed"; level: number }
  | { name: "level_accepted"; level: number; hoursToAccept: number }
  | { name: "level_revoked"; level: number }
  | { name: "permanent_proposed" }
  | { name: "attachment_sent"; kind: "image" | "file"; kb: number }
  // F-1 安全(S5)
  | { name: "block_created" }
  | { name: "block_released" }
  | {
      name: "report_submitted";
      category: "impersonation" | "harassment" | "inappropriate" | "other";
      withMessages: boolean;
    }
  // F-2 データ(S5)
  | { name: "data_exported" }
  | { name: "account_deleted"; daysSinceSignup: number }
  // G-1 / G-2 グループ(S6)
  | { name: "group_created"; members: number }
  | { name: "group_joined" }
  | { name: "group_left" }
  | { name: "group_deleted" };

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

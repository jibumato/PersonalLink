/**
 * 通報カテゴリの表示名。
 *
 * `lib/safety.ts` は server-only(DBを触る)なので、クライアントから
 * ラベルだけを使えるように分けてある。handle-format.ts と同じ理由。
 */
export type ReportCategory = "impersonation" | "harassment" | "inappropriate" | "other";

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  impersonation: "なりすまし",
  harassment: "迷惑行為",
  inappropriate: "不適切なコンテンツ",
  other: "その他",
};

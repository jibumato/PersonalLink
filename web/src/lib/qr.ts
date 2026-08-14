import "server-only";

/**
 * QR接続のトークン(仕様書 B-2 / B-3、設計判断 D-2)。
 *
 * ## QRの中身は URL の**フラグメント**にする
 *
 * `https://<host>/i#<token>` という形にしている。理由は2つ。
 *
 * 1. **URLなので標準のカメラアプリで読める。** 未登録の相手がその場でブラウザを開けることは、
 *    イベント会場での成立率に直結する(キラー体験)。独自形式だと自アプリのスキャナが要る。
 * 2. **フラグメントはサーバーに送信されない。** アクセスログや Referer にトークンが残らない。
 *    「QRトークンをURLに載せない」(T-9)の意図を、URLの利点を捨てずに満たせる。
 *
 * クライアント側で `location.hash` を読み、POST でサーバーへ渡す。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { qrTokens, QR_TOKEN_TTL_MINUTES, type QrExpiryDays } from "@/db/schema";

const SECRET = process.env.QR_TOKEN_SECRET ?? process.env.SESSION_SECRET ?? "dev-only-qr-secret";

function sign(tokenId: string): string {
  return createHmac("sha256", SECRET).update(tokenId).digest("base64url");
}

/** DBを引く前に、明らかに偽物のトークンを弾く。 */
function verifySignature(tokenId: string, mac: string): boolean {
  const expected = Buffer.from(sign(tokenId));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** QRに埋め込む文字列。`<tokenId>.<署名>` */
export function encodeToken(tokenId: string): string {
  return `${tokenId}.${sign(tokenId)}`;
}

export function decodeToken(payload: string): string | null {
  const idx = payload.lastIndexOf(".");
  if (idx <= 0) return null;
  const tokenId = payload.slice(0, idx);
  if (!verifySignature(tokenId, payload.slice(idx + 1))) return null;
  return tokenId;
}

/** 新しいQRトークンを発行する。表示のたびに呼ぶ(使い切り・5分失効)。 */
export async function issueQrToken(userId: string, expiryDays: QrExpiryDays) {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + QR_TOKEN_TTL_MINUTES * 60 * 1000);
  const [row] = await db
    .insert(qrTokens)
    .values({ userId, expiryDays, expiresAt })
    .returning({ id: qrTokens.id, expiresAt: qrTokens.expiresAt });
  return { payload: encodeToken(row.id), expiresAt: row.expiresAt };
}

export type TokenLookup =
  | { ok: true; tokenId: string; ownerId: string; expiryDays: number }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };

/** トークンを検証する(まだ消費しない)。接続確認画面(B-4)の表示用。 */
export async function lookupQrToken(payload: string): Promise<TokenLookup> {
  const tokenId = decodeToken(payload);
  if (!tokenId) return { ok: false, reason: "invalid" };

  const db = await getDb();
  const [row] = await db
    .select({
      id: qrTokens.id,
      userId: qrTokens.userId,
      expiryDays: qrTokens.expiryDays,
      expiresAt: qrTokens.expiresAt,
      consumedAt: qrTokens.consumedAt,
    })
    .from(qrTokens)
    .where(eq(qrTokens.id, tokenId))
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumedAt) return { ok: false, reason: "consumed" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, tokenId: row.id, ownerId: row.userId, expiryDays: row.expiryDays };
}

/**
 * トークンを消費する。**同時に2人が読み取っても1人しか成立しない**ように、
 * 「未消費のものだけを更新する」条件付きUPDATEで奪い合う。
 */
export async function consumeQrToken(tokenId: string, byUserId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(qrTokens)
    .set({ consumedAt: new Date(), consumedBy: byUserId })
    .where(
      and(
        eq(qrTokens.id, tokenId),
        isNull(qrTokens.consumedAt),
        sql`${qrTokens.expiresAt} > now()`,
      ),
    )
    .returning({ id: qrTokens.id });
  return rows.length > 0;
}

/** QRに載せるURL。フラグメントに置くことでサーバーへ送信されない。 */
export function qrUrl(origin: string, payload: string): string {
  return `${origin}/i#${payload}`;
}

export const TOKEN_ERROR_MESSAGE: Record<
  Extract<TokenLookup, { ok: false }>["reason"],
  string
> = {
  invalid: "Personal LINK のQRではありません",
  expired: "QRの有効期限が切れています。相手に再表示してもらってください",
  consumed: "このQRは使用済みです。相手に再表示してもらってください",
};

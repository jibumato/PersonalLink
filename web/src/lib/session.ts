/**
 * セッション管理。
 *
 * **認証方式に依存しない**([T-4](../../../docs/05-tech-stack.md))。
 * 「どうやって本人と確かめたか」はここに持ち込まない。確かめ終わったあとに `createSession()` を呼ぶ。
 * 方式が決まっても、このファイルは変更しなくてよい。
 *
 * JWT を使わない理由: MVP必須機能⑩「全端末ログアウト」は即時 revoke を要求する。
 * ステートレスな JWT は発行後に無効化できないため、この要件と原理的に両立しない。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { profiles, sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "pl_session";
const SESSION_TTL_DAYS = 90;
/** last_seen_at の更新頻度。毎リクエスト書くと無駄な書き込みが増える。 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * User-Agent から表示用の端末ラベルを作る。
 *
 * 端末を識別する目的ではなく、**F-3 で「どれが自分の今の端末か」を見分けるため**。
 * そのため粗い分類にとどめ、細かいバージョンは保存しない(憲法第二条)。
 */
export function deviceLabelFrom(userAgent: string | null): string {
  if (!userAgent) return "不明な端末";
  const os = /iPhone/.test(userAgent) ? "iPhone"
    : /iPad/.test(userAgent) ? "iPad"
    : /Android/.test(userAgent) ? "Android"
    : /Macintosh/.test(userAgent) ? "Mac"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : "不明な端末";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  return browser ? `${os} (${browser})` : os;
}

/**
 * セッションを作り、Cookie を設定する。
 *
 * 返すトークンは呼び出し側で保存しないこと。Cookie にだけ入れる。
 */
export async function createSession(userId: string, userAgent: string | null) {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      deviceLabel: deviceLabelFrom(userAgent),
      expiresAt,
    })
    .returning({ id: sessions.id });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { sessionId: row.id, expiresAt };
}

export type CurrentUser = {
  sessionId: string;
  userId: string;
  handle: string;
  displayName: string | null;
};

/**
 * Cookie から現在のユーザーを解決する。未ログインなら null。
 *
 * revoke 済み・期限切れは無効として扱う(全端末ログアウトが即座に効くのはこのため)。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      handle: users.handle,
      displayName: profiles.displayName,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        isNull(users.deletedAt),
        sql`${sessions.expiresAt} > now()`,
      ),
    )
    .limit(1);

  if (!row) return null;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    handle: row.handle,
    displayName: row.displayName,
  };
}

/** ログイン必須の画面・APIで使う。未ログインなら例外。 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "UnauthorizedError";
  }
}

/** この端末のログアウト。 */
export async function revokeCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  if (!token) return;
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/**
 * 全端末ログアウト(MVP必須機能⑩)。
 *
 * @param keepSessionId 指定したセッションだけ残す(「この端末以外からログアウト」)
 * @returns 失効させた件数
 */
export async function revokeAllSessions(userId: string, keepSessionId?: string) {
  const db = await getDb();
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        keepSessionId ? ne(sessions.id, keepSessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });

  if (!keepSessionId) {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
  }
  return rows.length;
}

/** 指定したセッション1件を失効させる(本人のものだけ)。 */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** F-3 に出す、有効なセッションの一覧。 */
export async function listSessions(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: sessions.id,
      deviceLabel: sessions.deviceLabel,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > now()`,
      ),
    )
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}

/** 定数時間比較。将来トークン照合を直接行う場合に使う。 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

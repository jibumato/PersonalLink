import "server-only";

/**
 * Connection の作成と一覧(仕様書 §3 の状態機械)。
 *
 * S2 の範囲は「成立」と「一覧」まで。期限の遷移(expiring / grace / expired)と
 * 継続確認は S4 の期限エンジンで実装する。
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import {
  connectionMembers,
  connections,
  pairKeyOf,
  profiles,
  users,
  GRACE_HOURS,
} from "@/db/schema";
import { deriveStatus, type ConnectionStatus } from "./renewal";

export type EstablishResult =
  | { ok: true; connectionId: string; expiresAt: Date }
  | { ok: false; reason: "self" | "already_connected"; connectionId?: string };

/**
 * Connection を成立させる。
 *
 * `expires_at` は「今から expiryDays 日後」。恒久化(expires_at = NULL)は S4 の継続確認で行う。
 */
export async function establishConnection(
  a: string,
  b: string,
  expiryDays: number,
): Promise<EstablishResult> {
  if (a === b) return { ok: false, reason: "self" };

  const db = await getDb();
  const pairKey = pairKeyOf(a, b);

  const existing = await findAliveConnection(a, b);
  if (existing) return { ok: false, reason: "already_connected", connectionId: existing.id };

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const graceUntil = new Date(expiresAt.getTime() + GRACE_HOURS * 60 * 60 * 1000);

  try {
    const [conn] = await db
      .insert(connections)
      .values({ pairKey, status: "active", expiresAt, graceUntil })
      .returning({ id: connections.id });
    await db.insert(connectionMembers).values([
      { connectionId: conn.id, userId: a },
      { connectionId: conn.id, userId: b },
    ]);
    // 関係のできごとをタイムラインに刻む(C-1 のシステムメッセージ)
    const { postSystemMessage } = await import("./message");
    await postSystemMessage(conn.id, `つながりました(期限: ${expiryDays}日間)`);
    return { ok: true, connectionId: conn.id, expiresAt };
  } catch {
    // 部分UNIQUE(不変条件7)が競合を弾いた場合。既存を返して二重成立を避ける。
    const again = await findAliveConnection(a, b);
    return { ok: false, reason: "already_connected", connectionId: again?.id };
  }
}

/** 生きている(expired でない)Connection を探す。 */
export async function findAliveConnection(a: string, b: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: connections.id, status: connections.status })
    .from(connections)
    .where(and(eq(connections.pairKey, pairKeyOf(a, b)), ne(connections.status, "expired")))
    .limit(1);
  return row ?? null;
}

export type ConnectionListItem = {
  id: string;
  status: ConnectionStatus;
  expiresAt: Date | null;
  establishedAt: Date;
  partner: { handle: string; displayName: string | null; bio: string | null };
};

/**
 * ホーム(B-1)に出す Connection 一覧。自分が隠したものは除く。
 * 状態は導出値。保存された status がズレていても、表示は常に正しい(T-8)。
 */
export async function listConnections(userId: string): Promise<ConnectionListItem[]> {
  const db = await getDb();
  // 同じテーブルを2回結合するので、相手側には別名を付ける
  // (オブジェクトのスプレッドでは別名にならず、同じテーブルを指してしまう)
  const partner = alias(connectionMembers, "partner");

  const rows = await db
    .select({
      id: connections.id,
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
      establishedAt: connections.establishedAt,
      handle: users.handle,
      displayName: profiles.displayName,
      bio: profiles.bio,
    })
    .from(connections)
    .innerJoin(
      connectionMembers,
      and(
        eq(connectionMembers.connectionId, connections.id),
        eq(connectionMembers.userId, userId),
        isNull(connectionMembers.hiddenAt),
      ),
    )
    // 相手側の行(自分ではない方)
    .innerJoin(
      partner,
      and(eq(partner.connectionId, connections.id), ne(partner.userId, userId)),
    )
    .innerJoin(users, eq(users.id, partner.userId))
    .leftJoin(profiles, eq(profiles.userId, partner.userId))
    .orderBy(desc(connections.establishedAt));

  // 保存された status ではなく導出を使う(T-8)
  return rows.map((r) => ({
    id: r.id,
    status: deriveStatus(r),
    expiresAt: r.expiresAt,
    establishedAt: r.establishedAt,
    partner: { handle: r.handle, displayName: r.displayName, bio: r.bio },
  }));
}

/** 期限までの残り日数(切り上げ)。恒久なら null。 */
export function remainingDays(expiresAt: Date | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(1, Math.round((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)));
}

/**
 * 「まもなく期限」と「つながり中」に分ける(B-1)。
 * 期限が近いものを見落とさせないため、残り24時間未満を上に出す。
 */
export function splitByUrgency(items: ConnectionListItem[], now = Date.now()) {
  const expiring: ConnectionListItem[] = [];
  const rest: ConnectionListItem[] = [];
  for (const i of items) {
    const soon = i.expiresAt !== null && i.expiresAt.getTime() - now < 24 * 60 * 60 * 1000;
    (soon ? expiring : rest).push(i);
  }
  return { expiring, rest };
}

/** 残り時間の表示(B-1 / C-1 の期限バッジ)。 */
export function remainingLabel(expiresAt: Date | null): string {
  if (!expiresAt) return "♾ 恒久";
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "期限終了";
  const hours = ms / (60 * 60 * 1000);
  if (hours >= 48) return `⏳ 残り${Math.ceil(hours / 24)}日`;
  return `⏳ 残り${Math.ceil(hours)}時間`;
}

/** 公開プロフィール(Level 0)。接続前でも見えるのはここだけ(憲法第五条)。 */
export async function getPublicProfile(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: profiles.displayName,
      bio: profiles.bio,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

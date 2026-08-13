import "server-only";

/**
 * データの持ち出しと消去(仕様書 F-2 / 憲法第六条)。
 *
 * ## 立場
 *
 * 「いつでも全部持ち出せて、いつでも完全に消せる」ことが、
 * **この会社を信頼しなくてよい**(憲法第十条)の実体。
 * だから両方とも、申請でも問い合わせでもなく**その場で実行できる**機能にする。
 */
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  attachments,
  blocks,
  connectionMembers,
  connections,
  levelGrants,
  messages,
  profiles,
  renewalChoices,
  sessions,
  users,
} from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { track } from "./analytics";

/**
 * 全データのエクスポート(F-2)。
 *
 * ⚠️ **相手の情報は最小限にとどめる。** 自分のデータを持ち出す機能であって、
 * 相手のデータを吸い出す機能ではない。相手については @ID と表示名だけ。
 *
 * ⚠️ **相手が「継続しない」を選んだかは含めない**(D-3)。
 * エクスポートは秘匿の抜け道になりやすい。含めない理由をここに書いておく。
 */
export async function exportAccount(userId: string): Promise<Record<string, unknown>> {
  const db = await getDb();
  const partner = alias(connectionMembers, "partner");

  const [me] = await db
    .select({
      handle: users.handle,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      bio: profiles.bio,
      detail: profiles.detail,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const conns = await db
    .select({
      id: connections.id,
      status: connections.status,
      establishedAt: connections.establishedAt,
      expiresAt: connections.expiresAt,
      endedAt: connections.endedAt,
      partnerHandle: users.handle,
      partnerName: profiles.displayName,
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
    // 相手側の行(自分ではない方)。listConnections と同じ形
    .innerJoin(
      partner,
      and(eq(partner.connectionId, connections.id), ne(partner.userId, userId)),
    )
    .innerJoin(users, eq(users.id, partner.userId))
    .leftJoin(profiles, eq(profiles.userId, partner.userId))
    .orderBy(desc(connections.establishedAt));

  const conversations = await Promise.all(
    conns.map(async (c) => {
      const rows = await db
        .select({
          createdAt: messages.createdAt,
          senderId: messages.senderId,
          kind: messages.kind,
          body: messages.body,
          retractedAt: messages.retractedAt,
          attachmentName: attachments.filename,
        })
        .from(messages)
        .leftJoin(attachments, eq(attachments.messageId, messages.id))
        .where(eq(messages.connectionId, c.id))
        .orderBy(asc(messages.createdAt));

      return {
        partner: { handle: c.partnerHandle, displayName: c.partnerName },
        status: c.status,
        establishedAt: c.establishedAt,
        expiresAt: c.expiresAt,
        endedAt: c.endedAt,
        levels: await db
          .select({ level: levelGrants.level, grantedAt: levelGrants.grantedAt })
          .from(levelGrants)
          .where(and(eq(levelGrants.connectionId, c.id), isNull(levelGrants.revokedAt))),
        messages: rows
          // 自分の画面から消したものは、自分のエクスポートにも出さない
          .map((m) => ({
            at: m.createdAt,
            from: m.senderId === userId ? "me" : m.senderId === null ? "system" : "partner",
            kind: m.kind,
            body: m.retractedAt ? null : m.body,
            attachment: m.attachmentName,
            retracted: m.retractedAt !== null,
          })),
      };
    }),
  );

  const blocked = await db
    .select({ handle: users.handle, createdAt: blocks.createdAt })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(and(eq(blocks.blockerId, userId), isNull(blocks.releasedAt)));

  const devices = await db
    .select({
      label: sessions.deviceLabel,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

  track({ name: "data_exported" });
  return {
    exportedAt: new Date().toISOString(),
    format: "personallink-export/v1",
    note:
      "相手の選択(継続する/しない)は含まれません。相手にも同じ秘匿が働いているためです(D-3)。",
    account: me,
    connections: conversations,
    blocked,
    devices,
    /** 自分の継続選択だけ。相手のぶんは含めない(D-3) */
    myRenewalChoices: await db
      .select({ connectionId: renewalChoices.connectionId, choice: renewalChoices.choice })
      .from(renewalChoices)
      .where(eq(renewalChoices.userId, userId)),
  };
}

/**
 * アカウント削除(F-2 / 憲法第六条)。**即時・完全**。
 *
 * 論理削除にしない。`users` を DELETE すれば、外部キーの ON DELETE CASCADE で
 * セッション・プロフィール・参加・添付の実体まで一緒に消える。
 * 「消したはずが残っていた」を設計で起こらなくする。
 *
 * 相手側に残るもの: **相手が受け取ったメッセージの本文**。
 * これは相手のデータでもあるので、こちらの一存では消さない
 * (取り消し(D-12)は24時間以内なら可能)。
 * ただし送信者への参照は消える(sender_id は cascade で行ごと消える)。
 *
 * @ID は解放せず90日間予約する — なりすまし防止(A-2)。
 */
export async function deleteAccount(userId: string): Promise<{ ok: true }> {
  const db = await getDb();
  const [me] = await db
    .select({ handle: users.handle, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (me) {
    const { HANDLE_RESERVATION_DAYS, handleReservations } = await import("@/db/schema");
    // 予約は本人参照を持たせない。本人ごと消えるので previous_user_id は残せない
    await db
      .insert(handleReservations)
      .values({
        handle: me.handle,
        previousUserId: null,
        reservedUntil: new Date(Date.now() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing();
    track({
      name: "account_deleted",
      daysSinceSignup: Math.max(
        0,
        Math.round((Date.now() - me.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      ),
    });
  }

  await db.delete(users).where(eq(users.id, userId));
  return { ok: true };
}

import "server-only";

/**
 * グループ(仕様書 G-1 / G-2 / D-11)。
 *
 * ## 1対1とは独立した合意の場
 *
 * グループは**期限もレベルも持たない**(D-11)。そして重要なのは向きの独立:
 *
 * - グループで同席しても、1対1の Connection レベルは**1ミリも動かない**
 * - 1対1が期限終了しても、グループ内の会話は**続く**
 *
 * 「同じ部屋にいた」を「親しくなった」に読み替えないための線引き。
 *
 * ## 勝手に入れない
 *
 * 招待された時点ではメンバーではない(`joined_at` が NULL)。
 * 本人が参加を選んで初めて会話が見える。ここを省くと
 * 「知らないうちに知らない人と同席していた」が起きる。
 */
import { and, asc, desc, eq, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  connectionMembers,
  connections,
  groupMembers,
  groups,
  messages,
  profiles,
  users,
} from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { deriveStatus } from "./renewal";
import { track } from "./analytics";

/** グループの上限。小さく始める(D-11: コアループ外なので最小仕様)。 */
export const MAX_GROUP_MEMBERS = 30;

export type GroupListItem = {
  id: string;
  name: string;
  /** 招待されたが、まだ参加していない */
  pending: boolean;
  memberCount: number;
};

/** 招待できる相手(G-1)。**生きている Connection の相手だけ**。 */
export async function invitableConnections(userId: string) {
  const db = await getDb();
  const partner = alias(connectionMembers, "partner");
  const rows = await db
    .select({
      userId: partner.userId,
      handle: users.handle,
      displayName: profiles.displayName,
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
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
    .innerJoin(
      partner,
      and(eq(partner.connectionId, connections.id), ne(partner.userId, userId)),
    )
    .innerJoin(users, eq(users.id, partner.userId))
    .leftJoin(profiles, eq(profiles.userId, partner.userId));

  // active か permanent のみ。grace / expired は招待できない(G-1)
  return rows
    .filter((r) => {
      const st = deriveStatus(r);
      return st === "active" || st === "permanent";
    })
    .map((r) => ({
      userId: r.userId,
      handle: r.handle,
      displayName: r.displayName,
    }));
}

export type CreateResult =
  | { ok: true; groupId: string }
  | { ok: false; error: string };

/**
 * グループを作る(G-1)。
 *
 * 招待できるのは**生きている Connection の相手だけ**。
 * ここを緩めると、グループが「知らない人とつながる裏口」になる。
 */
export async function createGroup(
  userId: string,
  name: string,
  memberIds: string[],
): Promise<CreateResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "グループ名を入力してください" };
  if (trimmed.length > 40) return { ok: false, error: "グループ名が長すぎます" };

  const invitable = new Set((await invitableConnections(userId)).map((c) => c.userId));
  const targets = [...new Set(memberIds)].filter((id) => id !== userId);
  if (targets.length === 0) return { ok: false, error: "メンバーを1人以上選んでください" };
  if (targets.some((id) => !invitable.has(id))) {
    return { ok: false, error: "つながっていない相手は招待できません" };
  }
  if (targets.length + 1 > MAX_GROUP_MEMBERS) {
    return { ok: false, error: `メンバーは${MAX_GROUP_MEMBERS}人までです` };
  }

  const db = await getDb();
  const [g] = await db
    .insert(groups)
    .values({ name: trimmed, ownerId: userId })
    .returning({ id: groups.id });

  await db.insert(groupMembers).values([
    // 作成者は招待を挟まずに参加済み
    { groupId: g.id, userId, invitedBy: userId, joinedAt: new Date() },
    ...targets.map((id) => ({ groupId: g.id, userId: id, invitedBy: userId })),
  ]);

  await postGroupSystemMessage(g.id, `「${trimmed}」が作成されました`);
  track({ name: "group_created", members: targets.length + 1 });
  return { ok: true, groupId: g.id };
}

/** ホーム(B-1)に出すグループ一覧。招待中のものも含む。 */
export async function listGroups(userId: string): Promise<GroupListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      joinedAt: groupMembers.joinedAt,
      memberCount: sql<number>`(
        select count(*)::int from ${groupMembers} m
        where m.group_id = ${groups.id} and m.joined_at is not null and m.left_at is null
      )`,
    })
    .from(groups)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
      ),
    )
    .where(isNull(groups.deletedAt))
    .orderBy(desc(groups.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pending: r.joinedAt === null,
    memberCount: r.memberCount,
  }));
}

export type GroupMemberView = {
  userId: string;
  handle: string;
  displayName: string | null;
  joined: boolean;
  isOwner: boolean;
};

export type GroupContext = {
  id: string;
  name: string;
  isOwner: boolean;
  /** 自分が参加済みか。招待中なら false で、会話は見えない */
  joined: boolean;
  members: GroupMemberView[];
};

/** G-2 の文脈。**参加していなければメッセージは読ませない**。 */
export async function loadGroupContext(
  userId: string,
  groupId: string,
): Promise<GroupContext | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: groups.id,
      name: groups.name,
      ownerId: groups.ownerId,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groups)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
      ),
    )
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
    .limit(1);
  if (!row) return null;

  const members = await db
    .select({
      userId: groupMembers.userId,
      handle: users.handle,
      displayName: profiles.displayName,
      joinedAt: groupMembers.joinedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .leftJoin(profiles, eq(profiles.userId, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)))
    .orderBy(asc(groupMembers.invitedAt));

  return {
    id: row.id,
    name: row.name,
    isOwner: row.ownerId === userId,
    joined: row.joinedAt !== null,
    members: members.map((m) => ({
      userId: m.userId,
      handle: m.handle,
      displayName: m.displayName,
      joined: m.joinedAt !== null,
      isOwner: m.userId === row.ownerId,
    })),
  };
}

export type GroupActionResult = { ok: true } | { ok: false; error: string };

/** 招待を受けて参加する(G-1)。ここで初めて会話が見える。 */
export async function joinGroup(userId: string, groupId: string): Promise<GroupActionResult> {
  const db = await getDb();
  const joined = await db
    .update(groupMembers)
    .set({ joinedAt: new Date() })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.joinedAt),
        isNull(groupMembers.leftAt),
      ),
    )
    .returning({ userId: groupMembers.userId });
  if (joined.length === 0) return { ok: false, error: "参加できる招待がありません" };

  const name = await displayNameOf(userId);
  await postGroupSystemMessage(groupId, `${name} が参加しました`);
  track({ name: "group_joined" });
  return { ok: true };
}

/**
 * 招待を断る / 退出する。
 *
 * 断ったことは**システムメッセージにしない**。参加していない人の不参加は、
 * わざわざ全員に知らせるようなことではない(D-5 と同じ考え方)。
 */
export async function leaveGroup(userId: string, groupId: string): Promise<GroupActionResult> {
  const db = await getDb();
  const [before] = await db
    .select({ joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (!before) return { ok: false, error: "このグループにいません" };

  await db
    .update(groupMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
      ),
    );

  // 参加していた人が抜けたときだけ知らせる
  if (before.joinedAt !== null) {
    await postGroupSystemMessage(groupId, `${await displayNameOf(userId)} が退出しました`);
    track({ name: "group_left" });
  }
  return { ok: true };
}

/** 作成者だけがメンバーを外せる(G-2)。 */
export async function removeMember(
  userId: string,
  groupId: string,
  targetId: string,
): Promise<GroupActionResult> {
  const db = await getDb();
  const [g] = await db
    .select({ ownerId: groups.ownerId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!g || g.ownerId !== userId) return { ok: false, error: "権限がありません" };
  if (targetId === userId) return { ok: false, error: "作成者は自分を外せません" };

  await db
    .update(groupMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, targetId),
        isNull(groupMembers.leftAt),
      ),
    );
  await postGroupSystemMessage(groupId, `${await displayNameOf(targetId)} が退出しました`);
  return { ok: true };
}

/** 作成者だけがグループを消せる(G-2)。 */
export async function deleteGroup(userId: string, groupId: string): Promise<GroupActionResult> {
  const db = await getDb();
  const deleted = await db
    .update(groups)
    .set({ deletedAt: new Date() })
    .where(and(eq(groups.id, groupId), eq(groups.ownerId, userId), isNull(groups.deletedAt)))
    .returning({ id: groups.id });
  if (deleted.length === 0) return { ok: false, error: "権限がありません" };
  track({ name: "group_deleted" });
  return { ok: true };
}

/** 追加招待(G-2)。作成者でなくても、自分がつながっている相手なら呼べる。 */
export async function inviteToGroup(
  userId: string,
  groupId: string,
  targetId: string,
): Promise<GroupActionResult> {
  const ctx = await loadGroupContext(userId, groupId);
  if (!ctx || !ctx.joined) return { ok: false, error: "このグループにいません" };
  if (ctx.members.length >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: `メンバーは${MAX_GROUP_MEMBERS}人までです` };
  }

  const invitable = new Set((await invitableConnections(userId)).map((c) => c.userId));
  if (!invitable.has(targetId)) {
    return { ok: false, error: "つながっていない相手は招待できません" };
  }

  const db = await getDb();
  await db
    .insert(groupMembers)
    .values({ groupId, userId: targetId, invitedBy: userId })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      // 一度退出した人を再招待する場合は招待状態に戻す
      set: { leftAt: null, joinedAt: null, invitedBy: userId, invitedAt: new Date() },
    });
  return { ok: true };
}

/** グループのシステムメッセージ。1対1と同じく送信者を持たない。 */
export async function postGroupSystemMessage(groupId: string, body: string) {
  const db = await getDb();
  await db.insert(messages).values({ groupId, senderId: null, kind: "system", body });
}

async function displayNameOf(userId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .select({ handle: users.handle, displayName: profiles.displayName })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  // D-15: 表示名に敬称を足さない
  return row?.displayName ?? `@${row?.handle ?? "unknown"}`;
}

/** 未読数(B-1のバッジ)。自分の情報で、他のメンバーには返さない(D-8)。 */
export async function groupUnreadCounts(userId: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ groupId: messages.groupId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, messages.groupId),
        eq(groupMembers.userId, userId),
        isNotNull(groupMembers.joinedAt),
        isNull(groupMembers.leftAt),
      ),
    )
    .where(
      and(
        ne(messages.senderId, userId),
        isNull(messages.retractedAt),
        sql`not (${userId} = any(${messages.deletedBy}))`,
        sql`(${groupMembers.lastReadAt} is null or ${messages.createdAt} > ${groupMembers.lastReadAt})`,
      ),
    )
    .groupBy(messages.groupId);
  return new Map(rows.map((r) => [r.groupId!, r.count]));
}

export async function markGroupRead(userId: string, groupId: string) {
  const db = await getDb();
  await db
    .update(groupMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

// ------------------------------------------------------------
// グループのメッセージ
//
// 取り消し(D-12)と「自分の画面から削除」はメッセージIDだけで動くので、
// 1対1の実装([message.ts](./message.ts))をそのまま使える。
// ここに書くのは「グループとして読む・送る」ぶんだけ。
// ------------------------------------------------------------

import { attachments } from "@/db/schema";
import { toMessageView, type MessageView } from "./message";

/**
 * グループの会話を読む。
 *
 * ⚠️ **参加していない人には読ませない。** 招待されているだけでは見えない。
 */
export async function listGroupMessages(
  userId: string,
  groupId: string,
  since?: Date,
): Promise<MessageView[]> {
  const db = await getDb();
  const [member] = await db
    .select({ joinedAt: groupMembers.joinedAt })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNotNull(groupMembers.joinedAt),
        isNull(groupMembers.leftAt),
      ),
    )
    .limit(1);
  if (!member) return [];

  const rows = await db
    .select({
      message: messages,
      attachmentId: attachments.id,
      attachmentName: attachments.filename,
      attachmentMime: attachments.mime,
      senderHandle: users.handle,
      senderName: profiles.displayName,
    })
    .from(messages)
    .leftJoin(attachments, eq(attachments.messageId, messages.id))
    .leftJoin(users, eq(users.id, messages.senderId))
    .leftJoin(profiles, eq(profiles.userId, messages.senderId))
    .where(
      and(
        eq(messages.groupId, groupId),
        sql`not (${userId} = any(${messages.deletedBy}))`,
        since
          ? sql`(${messages.createdAt} > ${since} or ${messages.retractedAt} > ${since})`
          : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt));

  const now = Date.now();
  return rows.map((r) => {
    const view = toMessageView(
      r.message,
      userId,
      now,
      r.attachmentId
        ? { id: r.attachmentId, filename: r.attachmentName!, mime: r.attachmentMime! }
        : undefined,
    );
    // グループでは誰の発言か分からないと読めない。1対1では不要なので、ここでだけ足す
    if (!view.mine && r.message.senderId) {
      view.senderName = r.senderName ?? `@${r.senderHandle}`;
    }
    return view;
  });
}

/** ポーリング用。1対1と同じくサーバー時刻をカーソルにする。 */
export async function pollGroupMessages(
  userId: string,
  groupId: string,
  since?: Date,
): Promise<{ messages: MessageView[]; now: string }> {
  const db = await getDb();
  const [{ now }] = await db.select({ now: sql<string>`now()` }).from(groups).limit(1);
  return { messages: await listGroupMessages(userId, groupId, since), now };
}

export type GroupSendResult =
  | { ok: true; message: MessageView }
  | { ok: false; error: string };

/**
 * グループにメッセージを送る。
 *
 * **レベルは見ない**(D-11)。グループは1対1とは独立した合意の場なので、
 * 1対1で Lv.2 が解放されているかどうかとは無関係に写真も送れる。
 */
export async function sendGroupMessage(
  userId: string,
  groupId: string,
  body: string,
  muted: boolean,
): Promise<GroupSendResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "メッセージを入力してください" };
  if (text.length > 4000) return { ok: false, error: "長すぎます(4000文字まで)" };

  const ctx = await loadGroupContext(userId, groupId);
  if (!ctx) return { ok: false, error: "このグループは見つかりません" };
  if (!ctx.joined) return { ok: false, error: "参加すると書き込めます" };

  const db = await getDb();
  const [row] = await db
    .insert(messages)
    .values({ groupId, senderId: userId, kind: "text", body: text, muted })
    .returning();
  return { ok: true, message: toMessageView(row, userId) };
}

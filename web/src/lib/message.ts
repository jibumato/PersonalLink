import "server-only";

/**
 * メッセージの送受信(仕様書 C-1 / C-3 / C-4)。
 *
 * このファイルが守るべき3つの不変条件:
 *
 * 1. **既読情報を相手に返さない**(D-8)。`last_read_at` は自分の未読バッジ専用。
 * 2. **`muted` を受信側に返さない**(D-13)。送り手の配慮を相手への圧に変えない。
 * 3. **取り消しは物理削除**(D-12)。本文をNULLにし、行はトゥームストーンとして残す。
 *
 * 1と2は「返し忘れ」ではなく「返す型に存在しない」ことで守る(下記 MessageView 参照)。
 */
import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import {
  connectionMembers,
  connections,
  messages,
  profiles,
  users,
  RETRACT_WINDOW_HOURS,
} from "@/db/schema";
import {
  canChooseRenewal,
  deriveStatus,
  isExpiring,
  type ConnectionStatus,
} from "./renewal";
import { track } from "./analytics";

/**
 * クライアントへ返すメッセージ。
 *
 * **`muted` は `mine` が true のときだけ入る**。受信側の型に存在しないので、
 * うっかり渡すことができない。既読を表すフィールドも存在しない。
 */
export type MessageView = {
  id: string;
  kind: "text" | "image" | "file" | "system";
  body: string | null;
  /** 自分が送ったものか */
  mine: boolean;
  createdAt: string;
  retracted: boolean;
  /** 自分の送信のみ。ミュートで送ったかどうか(D-13) */
  muted?: boolean;
  /** 自分の送信のみ。取り消せる時間内か(D-12) */
  canRetract?: boolean;
};

export type ChatContext = {
  connectionId: string;
  status: ConnectionStatus;
  expiresAt: Date | null;
  graceUntil: Date | null;
  establishedAt: Date;
  partner: { handle: string; displayName: string | null };
  /** メッセージを送れる状態か(不変条件1) */
  canSend: boolean;
  /** 期限接近。D-1 のバナーを出すか */
  expiring: boolean;
  /** 継続確認(D-2)を受け付ける期間か */
  canChooseRenewal: boolean;
};

/** 自分がそのConnectionの参加者かを確かめ、相手の情報とあわせて返す。 */
export async function loadChatContext(
  userId: string,
  connectionId: string,
): Promise<ChatContext | null> {
  const db = await getDb();
  // 相手側の行を取るため別名で2回結合する(listConnections と同じ形)
  const partner = alias(connectionMembers, "partner");
  const [row] = await db
    .select({
      id: connections.id,
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
      establishedAt: connections.establishedAt,
      handle: users.handle,
      displayName: profiles.displayName,
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
    .leftJoin(profiles, eq(profiles.userId, partner.userId))
    .where(eq(connections.id, connectionId))
    .limit(1);

  if (!row) return null;

  // 保存された status ではなく**導出**を使う。Cronが遅れていても正しく見える(T-8)
  const status = deriveStatus(row);
  return {
    connectionId: row.id,
    status,
    expiresAt: row.expiresAt,
    graceUntil: row.graceUntil,
    establishedAt: row.establishedAt,
    partner: { handle: row.handle, displayName: row.displayName },
    // 不変条件1。grace は閲覧のみ、expired は凍結(D-4)
    canSend: status === "active" || status === "permanent",
    expiring: isExpiring(row),
    canChooseRenewal: canChooseRenewal(row),
  };
}

function toView(
  row: typeof messages.$inferSelect,
  userId: string,
  now = Date.now(),
): MessageView {
  const mine = row.senderId === userId;
  const view: MessageView = {
    id: row.id,
    kind: row.kind,
    body: row.body,
    mine,
    createdAt: row.createdAt.toISOString(),
    retracted: row.retractedAt !== null,
  };
  if (mine) {
    // ここでしか muted / canRetract を載せない(D-13 / D-12)
    view.muted = row.muted;
    view.canRetract =
      row.retractedAt === null &&
      now - row.createdAt.getTime() < RETRACT_WINDOW_HOURS * 60 * 60 * 1000;
  }
  return view;
}

/**
 * 会話を読む。
 *
 * `since` を渡すと差分だけ返す。差分の条件は「新しく作られた」だけでなく
 * **「取り消された」も含む**。取り消しは既存の行の更新なので、
 * 作成時刻だけを見ていると**相手の画面に取り消しが反映されない**(D-12が実質壊れる)。
 */
export async function listMessages(
  userId: string,
  connectionId: string,
  since?: Date,
): Promise<MessageView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.connectionId, connectionId),
        // 「自分の画面から削除」したものは自分には返さない(相手には残る)
        sql`not (${userId} = any(${messages.deletedBy}))`,
        // ミュートで送られたメッセージも通常どおり届ける。抑止するのは「通知」だけ(D-13)
        since
          ? or(gt(messages.createdAt, since), gt(messages.retractedAt, since))
          : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt));

  const now = Date.now();
  return rows.map((r) => toView(r, userId, now));
}

/**
 * ポーリング用。差分と**サーバー時刻**を返す。
 *
 * 次回の `since` にサーバー時刻を使うことで、端末とサーバーの時計のズレで
 * 取りこぼしたり二重取得したりしない。
 */
export async function pollMessages(
  userId: string,
  connectionId: string,
  since?: Date,
): Promise<{ messages: MessageView[]; now: string }> {
  const db = await getDb();
  const [{ now }] = await db.select({ now: sql<string>`now()` }).from(connections).limit(1);
  return { messages: await listMessages(userId, connectionId, since), now };
}

export type SendResult =
  | { ok: true; message: MessageView }
  | { ok: false; error: string };

/** メッセージを送る。`muted` の扱いは D-13。 */
export async function sendMessage(
  userId: string,
  connectionId: string,
  body: string,
  muted: boolean,
): Promise<SendResult> {
  const text = body.trim();
  if (!text) return { ok: false, error: "メッセージを入力してください" };
  if (text.length > 4000) return { ok: false, error: "長すぎます(4000文字まで)" };

  const ctx = await loadChatContext(userId, connectionId);
  if (!ctx) return { ok: false, error: "この会話は見つかりません" };
  if (!ctx.canSend) {
    return {
      ok: false,
      error:
        ctx.status === "grace" || ctx.status === "expired"
          ? "期限が終了したため、メッセージは送れません"
          : "この会話にはメッセージを送れません",
    };
  }

  const db = await getDb();
  const [row] = await db
    .insert(messages)
    .values({ connectionId, senderId: userId, kind: "text", body: text, muted })
    .returning();

  // muted のときは通知を送らない。抑止はサーバー側で完結させる(D-13)
  if (!muted) notifyNewMessage(connectionId, userId);

  return { ok: true, message: toView(row, userId) };
}

/** システムメッセージ(成立・レベル解放・恒久化・期限終了)。送信者を持たない。 */
export async function postSystemMessage(connectionId: string, body: string) {
  const db = await getDb();
  await db.insert(messages).values({ connectionId, senderId: null, kind: "system", body });
}

/**
 * 送信取り消し(D-12)。
 *
 * - 送信者本人のみ / 24時間以内 / expired では不可
 * - **本文を物理削除**する。行はトゥームストーンとして残す
 * - 相手に通知しない(「何かが消された」と知らせて詮索を誘わない)
 */
export async function retractMessage(
  userId: string,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: messages.id,
      connectionId: messages.connectionId,
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      retractedAt: messages.retractedAt,
      status: connections.status,
    })
    .from(messages)
    .innerJoin(connections, eq(connections.id, messages.connectionId))
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!row || row.senderId !== userId) return { ok: false, error: "取り消せません" };
  if (row.retractedAt) return { ok: true };
  if (row.status === "expired") {
    return { ok: false, error: "終了した接続では取り消せません" };
  }
  if (Date.now() - row.createdAt.getTime() >= RETRACT_WINDOW_HOURS * 60 * 60 * 1000) {
    return { ok: false, error: `送信から${RETRACT_WINDOW_HOURS}時間以内のみ取り消せます` };
  }

  // body を NULL にする = 物理削除。CHECK制約があるので、消し忘れるとINSERT/UPDATEが失敗する
  await db
    .update(messages)
    .set({ retractedAt: new Date(), body: null })
    .where(and(eq(messages.id, messageId), eq(messages.senderId, userId)));
  return { ok: true };
}

/** 「自分の画面から削除」。相手の画面には残る(D-12)。 */
export async function hideMessageForMe(userId: string, messageId: string) {
  const db = await getDb();
  await db
    .update(messages)
    .set({ deletedBy: sql`array_append(${messages.deletedBy}, ${userId}::uuid)` })
    .where(and(eq(messages.id, messageId), sql`not (${userId} = any(${messages.deletedBy}))`));
}

/**
 * 終了した接続の履歴を、**自分側だけ**完全に消す(D-3 / 憲法第六条)。
 *
 * 相手の履歴には触れない。自分の `connection_members` を隠すことで一覧からも消え、
 * 会話も開けなくなる。再接続したければQRを読み直せば**新しいConnection**になる。
 *
 * 終了済みにだけ許す。生きている接続を黙って消せると、相手からは
 * 「返事が来ない」状態になり、ブロック(S5)と区別がつかなくなる。
 */
export async function deleteHistoryForMe(
  userId: string,
  connectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadChatContext(userId, connectionId);
  if (!ctx) return { ok: false, error: "この接続は見つかりません" };
  if (ctx.status !== "expired") {
    return { ok: false, error: "履歴を削除できるのは終了した接続だけです" };
  }

  const db = await getDb();
  await db
    .update(messages)
    .set({ deletedBy: sql`array_append(${messages.deletedBy}, ${userId}::uuid)` })
    .where(
      and(
        eq(messages.connectionId, connectionId),
        sql`not (${userId} = any(${messages.deletedBy}))`,
      ),
    );
  await db
    .update(connectionMembers)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        eq(connectionMembers.connectionId, connectionId),
        eq(connectionMembers.userId, userId),
      ),
    );
  track({
    name: "expired_history_deleted",
    daysSinceConnect: Math.max(
      0,
      Math.round((Date.now() - ctx.establishedAt.getTime()) / (24 * 60 * 60 * 1000)),
    ),
  });
  return { ok: true };
}

/** 会話を開いたときに呼ぶ。未読バッジ用で、**相手には見せない**(D-8)。 */
export async function markRead(userId: string, connectionId: string) {
  const db = await getDb();
  await db
    .update(connectionMembers)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(connectionMembers.connectionId, connectionId),
        eq(connectionMembers.userId, userId),
      ),
    );
}

/** B-1 の未読バッジ。自分の `last_read_at` より新しい相手のメッセージ数。 */
export async function unreadCounts(userId: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({
      connectionId: messages.connectionId,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .innerJoin(
      connectionMembers,
      and(
        eq(connectionMembers.connectionId, messages.connectionId),
        eq(connectionMembers.userId, userId),
      ),
    )
    .where(
      and(
        ne(messages.senderId, userId),
        isNull(messages.retractedAt),
        sql`not (${userId} = any(${messages.deletedBy}))`,
        or(
          isNull(connectionMembers.lastReadAt),
          gt(messages.createdAt, connectionMembers.lastReadAt),
        ),
      ),
    )
    .groupBy(messages.connectionId);
  return new Map(rows.map((r) => [r.connectionId, r.count]));
}

/**
 * 新着通知。
 *
 * S3 ではフックだけ用意する。Web Push は Phase 2(PWA化)で本実装する。
 * **ここが呼ばれないこと**がミュート送信の実体(D-13)。
 */
function notifyNewMessage(connectionId: string, senderId: string) {
  // 本文は渡さない。通知に載せる内容は Phase 2 で設定に応じて決める(T-9)
  void connectionId;
  void senderId;
}

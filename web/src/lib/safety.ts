import "server-only";

/**
 * ブロックと通報(仕様書 F-1)。
 *
 * ## silent block
 *
 * ブロックは**相手に一切通知されず、相手のUIは何も変わらない**。
 * 相手の送信は成功し、送信済みと表示される。ただしこちらには届かない。
 *
 * 「ブロックされた」と分かる仕組みは、それ自体が報復や詮索の火種になる。
 * だから**気づかせない**ことを設計目標に置いている。
 * 実装上は「相手に何かをする」のではなく「自分の視界から外す」だけ
 * (フィルタは [notBlockedFor](./message.ts) にある)。
 *
 * ## 通報
 *
 * 本文の提供は**明示同意があるときだけ**(D-10 / 憲法第二条)。
 * 同意なしで本文が入ることを DB の CHECK 制約が拒否する。
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, messages, profiles, reports, users } from "@/db/schema";
import { track } from "./analytics";
import type { ReportCategory } from "./safety-labels";

export type { ReportCategory } from "./safety-labels";

/** 通報に添えられる直近メッセージの件数(F-1)。 */
export const REPORT_EVIDENCE_COUNT = 20;

/** 自分がブロックしている相手か。**自分にしか使わない**。 */
export async function isBlockedByMe(userId: string, otherId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerId, userId),
        eq(blocks.blockedId, otherId),
        isNull(blocks.releasedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type SafetyResult = { ok: true } | { ok: false; error: string };

/**
 * ブロックする。
 *
 * 相手には**何も送らない**。システムメッセージも残さない —
 * タイムラインに痕跡が出れば相手に伝わってしまう。
 */
export async function blockUser(userId: string, targetId: string): Promise<SafetyResult> {
  if (userId === targetId) return { ok: false, error: "自分はブロックできません" };
  const db = await getDb();
  await db
    .insert(blocks)
    .values({ blockerId: userId, blockedId: targetId })
    // すでにブロック中なら何もしない(部分UNIQUEに任せる)
    .onConflictDoNothing();
  track({ name: "block_created" });
  return { ok: true };
}

/**
 * ブロックを解除する(F-2 のブロックリストから)。
 *
 * ⚠️ **ブロック中に届かなかったメッセージは配信しない。**
 * 行を消さず `released_at` を刻むことで、その期間を永久に覚えておく。
 */
export async function unblockUser(userId: string, targetId: string): Promise<SafetyResult> {
  const db = await getDb();
  await db
    .update(blocks)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(blocks.blockerId, userId),
        eq(blocks.blockedId, targetId),
        isNull(blocks.releasedAt),
      ),
    );
  track({ name: "block_released" });
  return { ok: true };
}

export type BlockedUser = { userId: string; handle: string; displayName: string | null };

/** ブロックリスト(F-2)。 */
export async function listBlocked(userId: string): Promise<BlockedUser[]> {
  const db = await getDb();
  return db
    .select({
      userId: users.id,
      handle: users.handle,
      displayName: profiles.displayName,
    })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(blocks.blockerId, userId), isNull(blocks.releasedAt)))
    .orderBy(desc(blocks.createdAt));
}

/**
 * 通報する(F-1)。
 *
 * `withMessages` が false なら証跡は**作らない**(NULLのまま)。
 * 取り消し済みメッセージの本文は物理削除されているので、
 * 同意があっても証跡に**含みようがない**(D-12)。トゥームストーンの存在だけが残る。
 */
export async function submitReport(
  userId: string,
  input: {
    targetUserId: string;
    connectionId: string | null;
    category: ReportCategory;
    detail: string | null;
    withMessages: boolean;
  },
): Promise<SafetyResult> {
  if (userId === input.targetUserId) return { ok: false, error: "自分は通報できません" };

  const db = await getDb();
  let evidence: { at: string; mine: boolean; body: string | null }[] | null = null;

  if (input.withMessages && input.connectionId) {
    const rows = await db
      .select({
        createdAt: messages.createdAt,
        senderId: messages.senderId,
        body: messages.body,
        retractedAt: messages.retractedAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.connectionId, input.connectionId),
          sql`${messages.kind} <> 'system'`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(REPORT_EVIDENCE_COUNT);

    evidence = rows.reverse().map((r) => ({
      at: r.createdAt.toISOString(),
      mine: r.senderId === userId,
      // 取り消し済みは本文が存在しない。「あった」ことだけが残る
      body: r.retractedAt ? null : r.body,
    }));
  }

  await db.insert(reports).values({
    reporterId: userId,
    targetUserId: input.targetUserId,
    connectionId: input.connectionId,
    category: input.category,
    detail: input.detail,
    withMessages: input.withMessages,
    evidence,
  });
  track({
    name: "report_submitted",
    category: input.category,
    withMessages: input.withMessages,
  });
  return { ok: true };
}

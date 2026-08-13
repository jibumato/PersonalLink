import "server-only";

/**
 * Connection Level(仕様書 C-2 / E-1 / D-5)。
 *
 * ## 設計の骨格
 *
 * **解放は双方合意、停止は一方的・即時**(D-5)。この非対称が要。
 * 深めるのは2人の同意が要るが、浅くするのは自分ひとりで決められる。
 *
 * ## 拒否を持たない
 *
 * 「今はしない」は**提案者に一切伝わらない**。
 * 拒否カラムが無いので伝えようがなく、提案は保留のまま残る。
 * 断ったことが相手に見えると、断りづらくなって「双方合意」が形骸化する。
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  connectionMembers,
  connections,
  levelGrants,
  levelProposals,
  GRANTABLE_LEVELS,
  REPROPOSE_INTERVAL_HOURS,
  type GrantableLevel,
} from "@/db/schema";
import { postSystemMessage } from "./message";
import { deriveStatus } from "./renewal";
import { track } from "./analytics";

export const LEVEL_LABEL: Record<number, string> = {
  1: "メッセージ",
  2: "写真・ファイル",
  3: "音声・通話",
  4: "詳細プロフィール",
};

export function isGrantableLevel(n: number): n is GrantableLevel {
  return (GRANTABLE_LEVELS as readonly number[]).includes(n);
}

/** レベルの状態。**自分から見た**ものだけを返す。 */
export type LevelView = {
  level: number;
  label: string;
  /** 解放済みか */
  granted: boolean;
  /** MVPでは提供しない(D-6) */
  comingSoon: boolean;
  /** 自分が提案して、相手の返事待ち */
  proposedByMe: boolean;
  /** 相手が提案してきていて、自分が承諾できる */
  awaitingMyAnswer: boolean;
  /** いま提案できるか(72時間ルールを含む) */
  canPropose: boolean;
};

type ProposalRow = {
  level: number;
  proposedBy: string;
  proposedAt: Date;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
};

/**
 * この接続のレベル状況を、**その人の視点で**組み立てる。
 *
 * ⚠️ 返り値に「相手がカードを閉じたか」は含めない(D-5)。
 * `dismissedAt` は受け手自身の表示制御にしか使わない。
 */
export async function loadLevels(
  userId: string,
  connectionId: string,
  now = Date.now(),
): Promise<LevelView[] | null> {
  const db = await getDb();
  const [member] = await db
    .select({ userId: connectionMembers.userId })
    .from(connectionMembers)
    .where(
      and(
        eq(connectionMembers.connectionId, connectionId),
        eq(connectionMembers.userId, userId),
        isNull(connectionMembers.hiddenAt),
      ),
    )
    .limit(1);
  if (!member) return null;

  const [grants, proposals] = await Promise.all([
    db
      .select({ level: levelGrants.level })
      .from(levelGrants)
      .where(and(eq(levelGrants.connectionId, connectionId), isNull(levelGrants.revokedAt))),
    db
      .select({
        level: levelProposals.level,
        proposedBy: levelProposals.proposedBy,
        proposedAt: levelProposals.proposedAt,
        acceptedAt: levelProposals.acceptedAt,
        dismissedAt: levelProposals.dismissedAt,
      })
      .from(levelProposals)
      .where(eq(levelProposals.connectionId, connectionId))
      .orderBy(desc(levelProposals.proposedAt)),
  ]);

  const grantedSet = new Set(grants.map((g) => g.level));
  return [1, 2, 3, 4].map((level) =>
    buildLevelView(level, userId, grantedSet, proposals, now),
  );
}

function buildLevelView(
  level: number,
  userId: string,
  grantedSet: Set<number>,
  proposals: ProposalRow[],
  now: number,
): LevelView {
  const label = LEVEL_LABEL[level];
  // Lv.1 は成立時に暗黙で付く。レコードを持たない
  if (level === 1) {
    return {
      level,
      label,
      granted: true,
      comingSoon: false,
      proposedByMe: false,
      awaitingMyAnswer: false,
      canPropose: false,
    };
  }
  if (!isGrantableLevel(level)) {
    // Lv.3 は「準備中」(D-6)
    return {
      level,
      label,
      granted: false,
      comingSoon: true,
      proposedByMe: false,
      awaitingMyAnswer: false,
      canPropose: false,
    };
  }

  const granted = grantedSet.has(level);
  const forLevel = proposals.filter((p) => p.level === level && p.acceptedAt === null);
  const mine = forLevel.find((p) => p.proposedBy === userId);
  const theirs = forLevel.find((p) => p.proposedBy !== userId);

  return {
    level,
    label,
    granted,
    comingSoon: false,
    proposedByMe: !granted && mine !== undefined,
    awaitingMyAnswer: !granted && theirs !== undefined,
    canPropose: !granted && canProposeAgain(mine?.proposedAt, now),
  };
}

/** 再提案は72時間に1回まで(C-2。催促スパム防止)。 */
function canProposeAgain(lastProposedAt: Date | undefined, now: number): boolean {
  if (!lastProposedAt) return true;
  return now - lastProposedAt.getTime() >= REPROPOSE_INTERVAL_HOURS * 60 * 60 * 1000;
}

/** その接続でレベルが解放されているか。添付の可否など、機能ゲートの判定に使う。 */
export async function hasLevel(connectionId: string, level: GrantableLevel): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: levelGrants.id })
    .from(levelGrants)
    .where(
      and(
        eq(levelGrants.connectionId, connectionId),
        eq(levelGrants.level, level),
        isNull(levelGrants.revokedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type LevelActionResult = { ok: true } | { ok: false; error: string };

/** 参加者であることと、接続が生きていることを確かめる。 */
async function requireLiveMember(
  userId: string,
  connectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const [row] = await db
    .select({
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
    .where(eq(connections.id, connectionId))
    .limit(1);

  if (!row) return { ok: false, error: "この接続は見つかりません" };
  const status = deriveStatus(row);
  if (status === "expired") return { ok: false, error: "この接続はすでに終了しています" };
  return { ok: true };
}

/**
 * レベルを提案する(C-2)。
 *
 * 提案そのものは何も解放しない。相手が承諾して初めて発効する(D-5)。
 */
export async function proposeLevel(
  userId: string,
  connectionId: string,
  level: number,
): Promise<LevelActionResult> {
  if (!isGrantableLevel(level)) {
    return { ok: false, error: "このレベルはまだ提案できません" };
  }
  const live = await requireLiveMember(userId, connectionId);
  if (!live.ok) return live;

  const views = await loadLevels(userId, connectionId);
  const view = views?.find((v) => v.level === level);
  if (!view) return { ok: false, error: "この接続は見つかりません" };
  if (view.granted) return { ok: false, error: "すでに解放されています" };
  if (!view.canPropose) {
    return { ok: false, error: `再提案は${REPROPOSE_INTERVAL_HOURS}時間に1回までです` };
  }

  const db = await getDb();
  await db.insert(levelProposals).values({ connectionId, level, proposedBy: userId });
  track({ name: "level_proposed", level });
  return { ok: true };
}

/**
 * 提案を承諾する(C-2)。承諾した瞬間に発効し、双方のタイムラインに残る。
 *
 * **自分が出した提案は自分では承諾できない。** そこを開けると「双方合意」が崩れる。
 */
export async function acceptLevel(
  userId: string,
  connectionId: string,
  level: number,
): Promise<LevelActionResult> {
  if (!isGrantableLevel(level)) return { ok: false, error: "このレベルは解放できません" };
  const live = await requireLiveMember(userId, connectionId);
  if (!live.ok) return live;

  const db = await getDb();
  // 相手が出した未承諾の提案だけを承諾できる
  const accepted = await db
    .update(levelProposals)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(levelProposals.connectionId, connectionId),
        eq(levelProposals.level, level),
        sql`${levelProposals.proposedBy} <> ${userId}`,
        isNull(levelProposals.acceptedAt),
      ),
    )
    .returning({ id: levelProposals.id, proposedAt: levelProposals.proposedAt });

  if (accepted.length === 0) {
    return { ok: false, error: "承諾できる提案がありません" };
  }

  // 生きている解放は (接続, レベル) に1つだけ。競合しても壊れない
  const granted = await db
    .insert(levelGrants)
    .values({ connectionId, level })
    .onConflictDoNothing()
    .returning({ id: levelGrants.id });

  if (granted.length > 0) {
    const icon = level === 2 ? "📷" : "🪪";
    await postSystemMessage(
      connectionId,
      `${icon} ${LEVEL_LABEL[level]}が解放されました(Lv.${level})`,
    );
    const hours = Math.round(
      (Date.now() - accepted[0].proposedAt.getTime()) / (60 * 60 * 1000),
    );
    track({ name: "level_accepted", level, hoursToAccept: hours });
  }
  return { ok: true };
}

/**
 * 「今はしない」(C-2)。
 *
 * ⚠️ **相手には何も起きない。** 提案は保留のまま残り、通知も行かない(D-5)。
 * ここで消しているのは、自分の画面に出ているカードだけ。
 */
export async function dismissProposal(
  userId: string,
  connectionId: string,
  level: number,
): Promise<LevelActionResult> {
  const db = await getDb();
  await db
    .update(levelProposals)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(levelProposals.connectionId, connectionId),
        eq(levelProposals.level, level),
        // 自分宛(=相手が出した)の未承諾の提案だけ
        sql`${levelProposals.proposedBy} <> ${userId}`,
        isNull(levelProposals.acceptedAt),
        isNull(levelProposals.dismissedAt),
      ),
    );
  return { ok: true };
}

/**
 * 解放を停止する(D-5)。**一方的・即時**。相手の同意は要らない。
 *
 * 停止はタイムラインに残す。黙って機能が消えると相手は不具合を疑うため。
 * ただし**誰が停めたかは書かない** — 咎める空気を作らない。
 */
export async function revokeLevel(
  userId: string,
  connectionId: string,
  level: number,
): Promise<LevelActionResult> {
  if (!isGrantableLevel(level)) return { ok: false, error: "このレベルは停止できません" };
  const db = await getDb();
  const [member] = await db
    .select({ userId: connectionMembers.userId })
    .from(connectionMembers)
    .where(
      and(
        eq(connectionMembers.connectionId, connectionId),
        eq(connectionMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, error: "この接続は見つかりません" };

  const revoked = await db
    .update(levelGrants)
    .set({ revokedAt: new Date(), revokedBy: userId })
    .where(
      and(
        eq(levelGrants.connectionId, connectionId),
        eq(levelGrants.level, level),
        isNull(levelGrants.revokedAt),
      ),
    )
    .returning({ id: levelGrants.id });

  if (revoked.length === 0) return { ok: false, error: "解放されていません" };

  await postSystemMessage(connectionId, `${LEVEL_LABEL[level]}の共有が停止されました`);
  track({ name: "level_revoked", level });
  return { ok: true };
}

/**
 * 恒久化の提案(E-1)。継続確認(D-2)と同じ双方合意フローに載せる。
 *
 * 期限が来ていなくても、いつでも「ずっとつながっていよう」と言える。
 */
export async function proposePermanent(
  userId: string,
  connectionId: string,
): Promise<LevelActionResult & { becamePermanent?: boolean }> {
  const { chooseRenewal } = await import("./renewal");
  const r = await chooseRenewal(userId, connectionId, "continue", { fromProposal: true });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, becamePermanent: r.becamePermanent };
}

/**
 * チャットに出す承諾カード(C-2)。
 *
 * **自分が「今はしない」で閉じたものは出さない。** ただし提案自体は保留のままで、
 * E-1 からはいつでも承諾できる。相手には閉じたことが伝わらない(D-5)。
 */
export async function pendingProposalFor(
  userId: string,
  connectionId: string,
): Promise<{ level: number; label: string } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ level: levelProposals.level })
    .from(levelProposals)
    .where(
      and(
        eq(levelProposals.connectionId, connectionId),
        sql`${levelProposals.proposedBy} <> ${userId}`,
        isNull(levelProposals.acceptedAt),
        isNull(levelProposals.dismissedAt),
      ),
    )
    .orderBy(desc(levelProposals.proposedAt))
    .limit(1);

  if (!row) return null;
  // すでに解放済みなら出さない(別経路で解放された場合)
  if (isGrantableLevel(row.level) && (await hasLevel(connectionId, row.level))) return null;
  return { level: row.level, label: LEVEL_LABEL[row.level] };
}

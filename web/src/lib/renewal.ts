import "server-only";

/**
 * 期限エンジン(仕様書 §3 の状態機械 / D-1〜D-4 / D-16)。
 *
 * ## 設計の骨格
 *
 * **状態の唯一の正は「導出」**([deriveStatus](#deriveStatus))。
 * `connections.status` カラムは「ジョブが最後に書いた値」にすぎない。
 * 読むときは必ず導出を通すので、**Cronが遅れてもユーザーには正しい状態が見える**(T-8)。
 * ジョブ側は導出結果にカラムを追随させ、そのタイミングでシステムメッセージを刻む。
 *
 * ## 秘匿(D-3 / D-16)
 *
 * 「継続しない」は**通知しない**だけでなく、**終了タイミングも変えない**。
 * 早く終わると猶予の有無から選択が推測できてしまうため、
 * 終了は選択によらず常に猶予終了時。ここが崩れると思想が壊れる。
 */
import { and, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { connectionMembers, connections, renewalChoices } from "@/db/schema";
import { postSystemMessage } from "./message";
import { track } from "./analytics";

/** つながってからの日数。計測に載せるのはこの粗さまで(憲法第二条)。 */
function daysSince(from: Date, now = Date.now()): number {
  return Math.max(0, Math.round((now - from.getTime()) / (24 * 60 * 60 * 1000)));
}

export type ConnectionStatus = "active" | "grace" | "permanent" | "expired";

/** 期限接近(D-1 のバナー・通知)とみなす残り時間。 */
export const EXPIRING_WINDOW_HOURS = 24;

export type StatusInput = {
  status: ConnectionStatus;
  expiresAt: Date | null;
  graceUntil: Date | null;
};

/**
 * 保存された状態と時刻から、**いまの本当の状態**を導く。
 *
 * ここが状態の唯一の正。画面もAPIもジョブも、必ずこれを通す。
 */
export function deriveStatus(row: StatusInput, now = Date.now()): ConnectionStatus {
  if (row.status === "permanent") return "permanent";
  if (row.status === "expired") return "expired";
  if (row.expiresAt && now < row.expiresAt.getTime()) return "active";
  if (row.graceUntil && now < row.graceUntil.getTime()) return "grace";
  return "expired";
}

/** 残り24時間を切っているか(D-1)。恒久・終了済みは対象外。 */
export function isExpiring(row: StatusInput, now = Date.now()): boolean {
  if (deriveStatus(row, now) !== "active" || !row.expiresAt) return false;
  return row.expiresAt.getTime() - now <= EXPIRING_WINDOW_HOURS * 60 * 60 * 1000;
}

/** 継続確認を受け付ける期間か。期限24時間前から猶予終了まで(仕様書 §3)。 */
export function canChooseRenewal(row: StatusInput, now = Date.now()): boolean {
  const st = deriveStatus(row, now);
  if (st === "grace") return true;
  if (st === "active") return isExpiring(row, now);
  return false;
}

export type MyRenewalView = {
  /** **自分の**選択だけ。相手の選択は絶対に含めない(D-3) */
  myChoice: "continue" | "end" | null;
  canChoose: boolean;
  status: ConnectionStatus;
  expiresAt: Date | null;
  graceUntil: Date | null;
};

/**
 * 継続確認画面(D-2)に出す情報。
 *
 * ⚠️ **相手の選択を返さない。** 返り値の型に存在しないので、うっかり渡せない。
 */
export async function loadMyRenewal(
  userId: string,
  connectionId: string,
): Promise<MyRenewalView | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
      myChoice: renewalChoices.choice,
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
    .leftJoin(
      renewalChoices,
      and(
        eq(renewalChoices.connectionId, connections.id),
        eq(renewalChoices.userId, userId),
      ),
    )
    .where(eq(connections.id, connectionId))
    .limit(1);

  if (!row) return null;
  return {
    myChoice: row.myChoice ?? null,
    canChoose: canChooseRenewal(row),
    status: deriveStatus(row),
    expiresAt: row.expiresAt,
    graceUntil: row.graceUntil,
  };
}

export type ChooseResult =
  | { ok: true; becamePermanent: boolean }
  | { ok: false; error: string };

/**
 * 継続確認の選択を記録する(D-2)。
 *
 * 双方が `continue` をそろえた瞬間だけ、**即座に**恒久化して祝う。
 * `end` を選んでも何も起きない — 終了は猶予終了時に、選択によらず同じように行われる(D-16)。
 */
export async function chooseRenewal(
  userId: string,
  connectionId: string,
  choice: "continue" | "end",
  /**
   * E-1 の「恒久化を提案」から呼ぶときは、期限24時間前より前でも受け付ける。
   *
   * 早める側にしか効かないので D-16 は破れない。
   * 「継続しない」は従来どおり継続確認の期間内でしか選べない。
   */
  opts: { fromProposal?: boolean } = {},
): Promise<ChooseResult> {
  const db = await getDb();
  const [row] = await db
    .select({
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
      establishedAt: connections.establishedAt,
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
  if (status === "permanent") return { ok: true, becamePermanent: true };
  if (status === "expired") return { ok: false, error: "この接続はすでに終了しています" };
  const fromProposal = opts.fromProposal === true && choice === "continue";
  if (!fromProposal && !canChooseRenewal(row)) {
    return { ok: false, error: "継続確認はまだ受け付けていません" };
  }

  // 選択はあとから変えられる
  await db
    .insert(renewalChoices)
    .values({ connectionId, userId, choice })
    .onConflictDoUpdate({
      target: [renewalChoices.connectionId, renewalChoices.userId],
      set: { choice, chosenAt: new Date() },
    });

  // 誰が選んだかは載せない(D-3)。期限後継続率の分子/分母に使う匿名カウンタ
  track(fromProposal ? { name: "permanent_proposed" } : { name: "renewal_choice", choice });

  const becamePermanent = choice === "continue" && (await promoteIfBothContinue(connectionId));
  if (becamePermanent) {
    track({ name: "connection_permanent", daysSinceConnect: daysSince(row.establishedAt) });
  }
  return { ok: true, becamePermanent };
}

/**
 * 双方が「継続」を選んでいれば恒久化する(ポジティブは即時)。
 *
 * @returns 恒久化したら true(すでに恒久だった場合は false)
 */
export async function promoteIfBothContinue(connectionId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ userId: renewalChoices.userId, choice: renewalChoices.choice })
    .from(renewalChoices)
    .where(eq(renewalChoices.connectionId, connectionId));

  const continues = rows.filter((r) => r.choice === "continue");
  if (continues.length < 2) return false;

  // 恒久化 = 期限の撤廃(D-1)。CHECK制約があるので expires_at と grace_until も必ず外す
  const updated = await db
    .update(connections)
    .set({ status: "permanent", expiresAt: null, graceUntil: null })
    .where(and(eq(connections.id, connectionId), ne(connections.status, "permanent")))
    .returning({ id: connections.id });

  if (updated.length === 0) return false;
  await postSystemMessage(connectionId, "🎉 このConnectionは恒久になりました ♾");
  return true;
}

/**
 * 期限を過ぎたConnectionを終了させる(Cronから呼ぶ)。
 *
 * **猶予終了を過ぎたものだけ**を対象にする。選択内容は見ない(D-16)。
 * 遅延評価があるので、このジョブが遅れてもユーザーの見え方は正しいまま(T-8)。
 *
 * @returns 状態を進めた件数
 */
export async function advanceExpiries(): Promise<{ toGrace: number; toExpired: number }> {
  const db = await getDb();

  // 期限は過ぎたが猶予中 → grace
  const toGrace = await db
    .update(connections)
    .set({ status: "grace" })
    .where(
      and(
        eq(connections.status, "active"),
        lte(connections.expiresAt, sql`now()`),
        sql`${connections.graceUntil} > now()`,
      ),
    )
    .returning({ id: connections.id });

  // 猶予も過ぎた → expired
  const toExpired = await db
    .update(connections)
    .set({ status: "expired", endedAt: sql`now()` })
    .where(
      and(
        or(eq(connections.status, "active"), eq(connections.status, "grace")),
        lte(connections.graceUntil, sql`now()`),
      ),
    )
    .returning({ id: connections.id, establishedAt: connections.establishedAt });

  // 終了の記録はタイムラインに残す。**選択によらず同じ文言**(D-3)
  for (const c of toExpired) {
    await postSystemMessage(c.id, "この接続は期限を迎えました");
    track({ name: "connection_expired", daysSinceConnect: daysSince(c.establishedAt) });
  }
  return { toGrace: toGrace.length, toExpired: toExpired.length };
}

/**
 * 読み取り時の遅延評価(T-8)。
 *
 * 画面を開いた時点で、保存されている `status` が実態とズレていたら直す。
 * Cron が止まっていても、ユーザーが触った分だけは正しくなる。
 */
export async function reconcileStatus(connectionId: string): Promise<ConnectionStatus | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      status: connections.status,
      expiresAt: connections.expiresAt,
      graceUntil: connections.graceUntil,
      establishedAt: connections.establishedAt,
    })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!row) return null;

  const derived = deriveStatus(row);
  if (derived === row.status) return derived;

  await db
    .update(connections)
    .set({
      status: derived,
      endedAt: derived === "expired" ? new Date() : null,
    })
    .where(and(eq(connections.id, connectionId), eq(connections.status, row.status)));

  if (derived === "expired") {
    await postSystemMessage(connectionId, "この接続は期限を迎えました");
    track({ name: "connection_expired", daysSinceConnect: daysSince(row.establishedAt) });
  }
  return derived;
}

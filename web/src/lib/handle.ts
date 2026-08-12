import "server-only";

/**
 * Universal ID(@handle)の可用性判定。**サーバー専用**(DBを見る)。
 *
 * 形式検証はクライアントとも共有するため [handle-format.ts](./handle-format.ts) にある。
 * 仕様: [A-2](../../../docs/01-screen-design.md)
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { handleReservations, users, HANDLE_RESERVATION_DAYS } from "@/db/schema";
import { checkHandleFormat, type HandleCheck } from "./handle-format";

/**
 * 形式に加えて、実際に取得できるかを判定する。
 *
 * @param forUserId 指定すると、その人自身が手放した handle は予約中でも取得できる
 */
export async function checkHandleAvailable(
  raw: string,
  forUserId?: string,
): Promise<HandleCheck> {
  const format = checkHandleFormat(raw);
  if (!format.ok) return format;

  const handle = raw.trim();
  const db = await getDb();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1);
  if (existing) {
    return { ok: false, reason: "taken", message: "このIDは使われています" };
  }

  const [reserved] = await db
    .select({ previousUserId: handleReservations.previousUserId })
    .from(handleReservations)
    .where(
      and(
        eq(handleReservations.handle, handle),
        gt(handleReservations.reservedUntil, sql`now()`),
      ),
    )
    .limit(1);
  // 本人が手放した handle は、予約期間中でも取り戻せる
  if (reserved && reserved.previousUserId !== (forUserId ?? null)) {
    return {
      ok: false,
      reason: "held",
      message: "このIDは最近まで使われていたため、しばらく取得できません",
    };
  }

  return { ok: true };
}

/** handle を手放すときに予約を作る(なりすまし防止のクールダウン)。 */
export function reservationUntil(from = new Date()): Date {
  return new Date(from.getTime() + HANDLE_RESERVATION_DAYS * 24 * 60 * 60 * 1000);
}

export { checkHandleFormat, RESERVED_HANDLES } from "./handle-format";
export type { HandleCheck, HandleRejection } from "./handle-format";

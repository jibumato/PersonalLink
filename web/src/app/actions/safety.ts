"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blockUser, submitReport, unblockUser, type ReportCategory } from "@/lib/safety";
import { loadChatContext } from "@/lib/message";

/**
 * F-1 ブロック。**相手には何も起きない**(silent block)。
 *
 * 返り値にも相手側の状態は含まれない。ブロックは自分の視界の設定であって、
 * 相手に対する操作ではない。
 */
export async function block(connectionId: string) {
  const user = await requireUser();
  const ctx = await loadChatContext(user.userId, connectionId);
  if (!ctx) return { ok: false as const, error: "この接続は見つかりません" };
  const r = await blockUser(user.userId, ctx.partner.userId);
  if (r.ok) {
    revalidatePath(`/c/${connectionId}`);
    revalidatePath("/home");
  }
  return r;
}

/** F-2 ブロック解除。**解除しても、ブロック中のメッセージは配信されない**。 */
export async function unblock(targetUserId: string) {
  const user = await requireUser();
  const r = await unblockUser(user.userId, targetUserId);
  if (r.ok) {
    revalidatePath("/settings");
    revalidatePath("/home");
  }
  return r;
}

/** F-1 通報。本文の提供は同意チェックがあるときだけ(D-10)。 */
export async function report(
  connectionId: string,
  input: { category: ReportCategory; detail: string; withMessages: boolean },
) {
  const user = await requireUser();
  const ctx = await loadChatContext(user.userId, connectionId);
  if (!ctx) return { ok: false as const, error: "この接続は見つかりません" };
  return submitReport(user.userId, {
    targetUserId: ctx.partner.userId,
    connectionId,
    category: input.category,
    detail: input.detail.trim() || null,
    withMessages: input.withMessages,
  });
}

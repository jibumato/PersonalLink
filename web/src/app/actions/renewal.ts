"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { chooseRenewal, loadMyRenewal, type ChooseResult } from "@/lib/renewal";

/**
 * D-2 継続確認の選択。
 *
 * ⚠️ 返り値に**相手の選択を含めない**(D-3)。`becamePermanent` は
 * 「双方そろって恒久化した」という結果であって、相手の選択そのものではない
 * (恒久化は自分も continue を選んだ場合にしか起きないため、漏れる情報がない)。
 */
export async function choose(
  connectionId: string,
  choice: "continue" | "end",
): Promise<ChooseResult> {
  const user = await requireUser();
  const result = await chooseRenewal(user.userId, connectionId, choice);
  if (result.ok) {
    revalidatePath(`/c/${connectionId}`);
    revalidatePath("/home");
  }
  return result;
}

/** 自分の選択だけを読む。 */
export async function myRenewal(connectionId: string) {
  const user = await requireUser();
  return loadMyRenewal(user.userId, connectionId);
}

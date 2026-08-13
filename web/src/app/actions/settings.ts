"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { requireUser, revokeCurrentSession } from "@/lib/session";
import { deleteAccount } from "@/lib/account";

/** F-2 プロフィール編集。L0(公開)と L4(詳細)を別々に受ける。 */
export async function saveProfile(form: FormData) {
  const user = await requireUser();
  const displayName = String(form.get("displayName") ?? "").trim();
  const bio = String(form.get("bio") ?? "").trim();
  if (!displayName) return { ok: false as const, error: "表示名を入力してください" };
  if (displayName.length > 40) return { ok: false as const, error: "表示名が長すぎます" };
  if (bio.length > 50) return { ok: false as const, error: "ひとことは50文字までです" };

  const db = await getDb();
  await db
    .update(profiles)
    .set({ displayName, bio: bio || null, updatedAt: new Date() })
    .where(eq(profiles.userId, user.userId));
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * F-2 詳細プロフィール(L4)。
 *
 * ここに入れた内容は **Lv.4 を相互に解放した相手にしか見えない**。
 * 空欄は保存しない — 「空の項目名」がプロフィールに並ぶのを避ける。
 */
export async function saveDetail(form: FormData) {
  const user = await requireUser();
  const detail: Record<string, string> = {};
  for (const key of ["本名", "誕生日", "SNS", "所属"]) {
    const v = String(form.get(key) ?? "").trim();
    if (v) detail[key] = v.slice(0, 100);
  }

  const db = await getDb();
  await db
    .update(profiles)
    .set({ detail, updatedAt: new Date() })
    .where(eq(profiles.userId, user.userId));
  revalidatePath("/settings");
  return { ok: true as const };
}

/**
 * F-2 アカウント削除(憲法第六条)。**即時・完全**。
 *
 * 削除したらセッションも道連れになるので、Cookie も消してウェルカムへ戻す。
 */
export async function deleteMyAccount() {
  const user = await requireUser();
  // 先にCookieを落とす。削除後は自分のセッション行ごと消えるので、順序を逆にすると触れない
  await revokeCurrentSession();
  await deleteAccount(user.userId);
  redirect("/welcome");
}

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles, users } from "@/db/schema";
import { checkHandleAvailable } from "@/lib/handle";
import {
  createSession,
  getCurrentUser,
  requireUser,
  revokeAllSessions,
  revokeCurrentSession,
  revokeSession,
} from "@/lib/session";
import { assertDevLoginEnabled } from "@/lib/dev-auth";

export type FormState = { error?: string };

/**
 * @ID を確定してアカウントを作り、セッションを発行する(A-2)。
 *
 * 認証方式が未定([D-7](../../../../docs/01-screen-design.md))のため、現在は
 * 「@ID の確定 = アカウント作成」としている。方式が決まったら A-3(本人確認)を
 * この後ろに挿し込む。**セッション発行のコードは変更不要**(T-4)。
 */
export async function createAccount(_prev: FormState, form: FormData): Promise<FormState> {
  const handle = String(form.get("handle") ?? "").trim().toLowerCase();

  const check = await checkHandleAvailable(handle);
  if (!check.ok) return { error: check.message || "IDを入力してください" };

  const db = await getDb();
  let userId: string;
  try {
    const [row] = await db.insert(users).values({ handle }).returning({ id: users.id });
    userId = row.id;
  } catch {
    // 可用性チェックと INSERT の間に横取りされた場合。部分UNIQUE制約が最後の砦になる。
    return { error: "このIDは使われています" };
  }

  const ua = (await headers()).get("user-agent");
  await createSession(userId, ua);
  redirect("/signup/profile");
}

/** 表示名などの L0 プロフィールを保存する(A-4)。 */
export async function saveProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const displayName = String(form.get("displayName") ?? "").trim();
  const bio = String(form.get("bio") ?? "").trim();

  if (!displayName) return { error: "表示名を入力してください" };
  if (displayName.length > 30) return { error: "表示名は30文字までです" };
  if (bio.length > 50) return { error: "ひとことは50文字までです" };

  const db = await getDb();
  await db
    .insert(profiles)
    .values({ userId: user.userId, displayName, bio: bio || null })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { displayName, bio: bio || null, updatedAt: new Date() },
    });
  redirect("/home");
}

export async function logout() {
  await revokeCurrentSession();
  redirect("/welcome");
}

/** MVP必須機能⑩。keepCurrent=true なら「この端末以外からログアウト」。 */
export async function logoutEverywhere(form: FormData) {
  const user = await requireUser();
  const keepCurrent = form.get("keepCurrent") === "1";
  await revokeAllSessions(user.userId, keepCurrent ? user.sessionId : undefined);
  redirect(keepCurrent ? "/settings/devices" : "/welcome");
}

/** F-3 から特定の端末をログアウトさせる。 */
export async function logoutDevice(form: FormData) {
  const user = await requireUser();
  const sessionId = String(form.get("sessionId") ?? "");
  if (sessionId === user.sessionId) {
    // 自分自身を切るのは通常のログアウトと同じ扱いにする
    await revokeCurrentSession();
    redirect("/welcome");
  }
  await revokeSession(user.userId, sessionId);
  redirect("/settings/devices");
}

/**
 * 開発用の仮ログイン。**本番では無効**([dev-auth.ts](../../lib/dev-auth.ts))。
 * 認証方式が決まるまでの踏み台。
 */
export async function devLogin(_prev: FormState, form: FormData): Promise<FormState> {
  assertDevLoginEnabled();
  const handle = String(form.get("handle") ?? "").trim().toLowerCase();
  if (!handle) return { error: "IDを入力してください" };

  const db = await getDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return { error: `@${handle} は存在しません` };

  const ua = (await headers()).get("user-agent");
  await createSession(user.id, ua);
  redirect("/home");
}

/** 既ログインなら /home、未ログインなら /welcome へ。 */
export async function routeByAuth() {
  const user = await getCurrentUser();
  redirect(user ? "/home" : "/welcome");
}

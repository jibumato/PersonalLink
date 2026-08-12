"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type QrExpiryDays } from "@/db/schema";
import { requireUser, getCurrentUser } from "@/lib/session";
import { consumeQrToken, issueQrToken, lookupQrToken, TOKEN_ERROR_MESSAGE } from "@/lib/qr";
import { establishConnection, findAliveConnection } from "@/lib/connection";
import { track } from "@/lib/analytics";

/** QRの既定期限をユーザーごとに覚える(B-2 の期限チップ)。 */
const EXPIRY_COOKIE = "pl_qr_expiry";
/**
 * 未登録の相手が読み取ったときに、登録が終わるまでトークンを預かる Cookie(B-3)。
 * **キラー体験の要**: イベント会場でその場で登録して、そのまま接続まで完了させる。
 */
const TICKET_COOKIE = "pl_connect_ticket";

export async function getPreferredExpiryDays(): Promise<QrExpiryDays> {
  const raw = Number((await cookies()).get(EXPIRY_COOKIE)?.value);
  return raw === 1 || raw === 30 ? raw : 7;
}

export async function setPreferredExpiryDays(days: QrExpiryDays) {
  const jar = await cookies();
  jar.set(EXPIRY_COOKIE, String(days), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  track({ name: "qr_expiry_changed", expiryDays: days });
  revalidatePath("/qr");
}

/** 新しいQRトークンを発行する(B-2)。5分ごとの自動更新からも呼ばれる。 */
export async function refreshQrToken() {
  const user = await requireUser();
  const days = await getPreferredExpiryDays();
  const { payload, expiresAt } = await issueQrToken(user.userId, days);
  track({ name: "qr_displayed", expiryDays: days });
  return { payload, expiresAt: expiresAt.toISOString(), expiryDays: days };
}

export type ScanOutcome =
  | { kind: "confirm"; payload: string }
  | { kind: "signup"; ownerName: string }
  | { kind: "connected"; connectionId: string }
  | { kind: "error"; message: string };

/**
 * 読み取ったトークンを解決する(B-3)。ここではまだ接続しない。
 *
 * 未ログインなら**接続チケットとして預かり**、登録後に接続へ戻す。
 */
export async function resolveScan(payload: string): Promise<ScanOutcome> {
  const found = await lookupQrToken(payload);
  if (!found.ok) {
    track({ name: "qr_scanned", result: found.reason });
    return { kind: "error", message: TOKEN_ERROR_MESSAGE[found.reason] };
  }

  const me = await getCurrentUser();

  if (!me) {
    // 未登録・未ログイン: トークンを預かって登録フローへ(キラー体験)
    const jar = await cookies();
    jar.set(TICKET_COOKIE, payload, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 30,
    });
    track({ name: "scan_requires_signup", viaQr: true });
    const owner = await getOwnerName(found.ownerId);
    return { kind: "signup", ownerName: owner };
  }

  if (me.userId === found.ownerId) {
    track({ name: "qr_scanned", result: "self" });
    return { kind: "error", message: "自分のQRです" };
  }

  const alive = await findAliveConnection(me.userId, found.ownerId);
  if (alive) {
    track({ name: "qr_scanned", result: "already_connected" });
    return { kind: "connected", connectionId: alive.id };
  }

  track({ name: "qr_scanned", result: "ok" });
  return { kind: "confirm", payload };
}

async function getOwnerName(userId: string): Promise<string> {
  const { getPublicProfile } = await import("@/lib/connection");
  const p = await getPublicProfile(userId);
  return p?.displayName ?? (p ? `@${p.handle}` : "相手");
}

export type PeekResult =
  | {
      ok: true;
      target: { handle: string; displayName: string | null; bio: string | null; expiryDays: number };
    }
  | { ok: false; message: string };

/**
 * 接続確認画面(B-4)に出す相手の情報を取る。**Level 0(公開)だけ**を返す。
 * まだトークンは消費しない(「やめる」を選べるようにするため)。
 */
export async function peekConnectTarget(payload: string): Promise<PeekResult> {
  await requireUser();
  const found = await lookupQrToken(payload);
  if (!found.ok) return { ok: false, message: TOKEN_ERROR_MESSAGE[found.reason] };

  const { getPublicProfile } = await import("@/lib/connection");
  const profile = await getPublicProfile(found.ownerId);
  if (!profile) return { ok: false, message: "相手が見つかりませんでした" };

  return {
    ok: true,
    target: {
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      expiryDays: found.expiryDays,
    },
  };
}

export type ConnectResult = { error?: string };

/** 接続確認(B-4)で「つながる」を押したときの処理。 */
export async function confirmConnect(_prev: ConnectResult, form: FormData): Promise<ConnectResult> {
  const user = await requireUser();
  const payload = String(form.get("payload") ?? "");

  const found = await lookupQrToken(payload);
  if (!found.ok) return { error: TOKEN_ERROR_MESSAGE[found.reason] };
  if (found.ownerId === user.userId) return { error: "自分のQRです" };

  // 先にトークンを奪う。同時に2人が読んでも1人しか通らない。
  if (!(await consumeQrToken(found.tokenId, user.userId))) {
    return { error: TOKEN_ERROR_MESSAGE.consumed };
  }

  const result = await establishConnection(user.userId, found.ownerId, found.expiryDays);
  if (!result.ok) {
    if (result.reason === "already_connected" && result.connectionId) {
      redirect(`/home?already=1`);
    }
    return { error: "接続できませんでした" };
  }

  track({
    name: "connection_established",
    expiryDays: found.expiryDays,
    viaSignup: false,
  });
  redirect(`/home?established=${result.connectionId}`);
}

/**
 * 登録直後に、預かっていた接続チケットを使って接続する。
 * A-4(プロフィール設定)の完了時に呼ぶ。
 */
export async function redeemTicketIfAny(userId: string): Promise<string | null> {
  const jar = await cookies();
  const payload = jar.get(TICKET_COOKIE)?.value;
  if (!payload) return null;
  jar.delete(TICKET_COOKIE);

  const found = await lookupQrToken(payload);
  if (!found.ok || found.ownerId === userId) return null;
  if (!(await consumeQrToken(found.tokenId, userId))) return null;

  const result = await establishConnection(userId, found.ownerId, found.expiryDays);
  if (!result.ok) return null;

  track({ name: "connection_established", expiryDays: found.expiryDays, viaSignup: true });
  return result.connectionId;
}

/**
 * @ID を直接入力しての接続(B-3 のフォールバック)。
 *
 * **QRと違って即成立させない。** 本人が目の前で許可した文脈がないため、
 * 承認リクエストの仕組みが要る。それは S5 で実装する。
 */
export async function connectByHandle(_prev: ConnectResult, form: FormData): Promise<ConnectResult> {
  await requireUser();
  const handle = String(form.get("handle") ?? "").trim().toLowerCase();
  if (!handle) return { error: "IDを入力してください" };

  const db = await getDb();
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return { error: `@${handle} は見つかりませんでした` };

  return {
    error:
      "ID接続は相手の承認が必要です(QRと違い、その場で許可を得た文脈がないため)。この機能は S5 で実装します。",
  };
}

/** 端末ラベル用。Server Action から header を読むためのヘルパ。 */
export async function currentUserAgent() {
  return (await headers()).get("user-agent");
}

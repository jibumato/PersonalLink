"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  deleteHistoryForMe,
  hideMessageForMe,
  listMessages,
  markRead,
  pollMessages,
  retractMessage,
  sendMessage,
  type MessageView,
} from "@/lib/message";

export type SendState = { error?: string };

/** C-1 メッセージ送信。`muted` は D-13。 */
export async function send(
  connectionId: string,
  body: string,
  muted: boolean,
): Promise<{ ok: true; message: MessageView } | { ok: false; error: string }> {
  const user = await requireUser();
  const result = await sendMessage(user.userId, connectionId, body, muted);
  if (result.ok) revalidatePath("/home");
  return result;
}

/**
 * ポーリングで差分を取る(T-5: まずポーリング、のちSSE)。
 * 取り消し済みの行も差分に含まれるので、相手の画面にも取り消しが伝わる。
 */
export async function poll(connectionId: string, sinceIso: string | null) {
  const user = await requireUser();
  return pollMessages(user.userId, connectionId, sinceIso ? new Date(sinceIso) : undefined);
}

/** 会話全体を取り直す(取り消しなど、既存の行が変わったとき)。 */
export async function reload(connectionId: string) {
  const user = await requireUser();
  return listMessages(user.userId, connectionId);
}

/** C-3 送信取り消し(D-12)。相手には通知しない。 */
export async function retract(messageId: string) {
  const user = await requireUser();
  return retractMessage(user.userId, messageId);
}

/** C-3 自分の画面から削除。相手側には残る(D-12)。 */
export async function hideForMe(messageId: string) {
  const user = await requireUser();
  await hideMessageForMe(user.userId, messageId);
  return { ok: true as const };
}

/**
 * 添付を送る(不変条件2)。Lv.2 が解放されていない接続では送れない。
 *
 * Server Action で FormData を受ける。ファイルは Buffer にしてから渡す。
 */
export async function sendAttachmentAction(form: FormData) {
  const user = await requireUser();
  const connectionId = String(form.get("connectionId") ?? "");
  const muted = form.get("muted") === "1";
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "ファイルを選んでください" };

  const { sendAttachment } = await import("@/lib/attachment");
  const r = await sendAttachment(
    user.userId,
    connectionId,
    {
      mime: file.type,
      filename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
    },
    muted,
  );
  if (r.ok) revalidatePath("/home");
  return r;
}

/** D-3 終了した接続の履歴を自分側から消す(憲法第六条)。相手側には残る。 */
export async function deleteHistory(connectionId: string) {
  const user = await requireUser();
  const result = await deleteHistoryForMe(user.userId, connectionId);
  if (result.ok) revalidatePath("/home");
  return result;
}

/** 会話を開いたことを記録する。未読バッジ用で、相手には見せない(D-8)。 */
export async function markChatRead(connectionId: string) {
  const user = await requireUser();
  await markRead(user.userId, connectionId);
  revalidatePath("/home");
}

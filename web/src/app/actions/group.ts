"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  createGroup,
  deleteGroup,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  listGroupMessages,
  markGroupRead,
  pollGroupMessages,
  removeMember,
  sendGroupMessage,
} from "@/lib/group";

/** G-1 グループ作成。招待できるのは生きている Connection の相手だけ。 */
export async function create(form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "");
  const members = form.getAll("member").map(String);
  const r = await createGroup(user.userId, name, members);
  if (!r.ok) return r;
  revalidatePath("/home");
  redirect(`/g/${r.groupId}`);
}

/** G-1 招待を受けて参加する。ここで初めて会話が見える。 */
export async function join(groupId: string) {
  const user = await requireUser();
  const r = await joinGroup(user.userId, groupId);
  if (r.ok) {
    revalidatePath(`/g/${groupId}`);
    revalidatePath("/home");
  }
  return r;
}

/** G-1 招待を断る / G-2 退出する。 */
export async function leave(groupId: string) {
  const user = await requireUser();
  const r = await leaveGroup(user.userId, groupId);
  if (r.ok) revalidatePath("/home");
  return r;
}

/** G-2 作成者がメンバーを外す。 */
export async function remove(groupId: string, targetId: string) {
  const user = await requireUser();
  const r = await removeMember(user.userId, groupId, targetId);
  if (r.ok) revalidatePath(`/g/${groupId}`);
  return r;
}

/** G-2 作成者がグループを消す。 */
export async function destroy(groupId: string) {
  const user = await requireUser();
  const r = await deleteGroup(user.userId, groupId);
  if (r.ok) revalidatePath("/home");
  return r;
}

/** G-2 追加招待。 */
export async function invite(groupId: string, targetId: string) {
  const user = await requireUser();
  const r = await inviteToGroup(user.userId, groupId, targetId);
  if (r.ok) revalidatePath(`/g/${groupId}`);
  return r;
}

/** G-2 メッセージ送信。レベルは見ない(D-11)。 */
export async function sendToGroup(groupId: string, body: string, muted: boolean) {
  const user = await requireUser();
  const r = await sendGroupMessage(user.userId, groupId, body, muted);
  if (r.ok) revalidatePath("/home");
  return r;
}

export async function pollGroup(groupId: string, sinceIso: string | null) {
  const user = await requireUser();
  return pollGroupMessages(user.userId, groupId, sinceIso ? new Date(sinceIso) : undefined);
}

export async function reloadGroup(groupId: string) {
  const user = await requireUser();
  return listGroupMessages(user.userId, groupId);
}

export async function markRead(groupId: string) {
  const user = await requireUser();
  await markGroupRead(user.userId, groupId);
  return { ok: true as const };
}

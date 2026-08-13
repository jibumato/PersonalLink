"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  acceptLevel,
  dismissProposal,
  proposeLevel,
  proposePermanent,
  revokeLevel,
} from "@/lib/level";

/** C-2 レベルを提案する。相手が承諾するまで何も解放されない(D-5)。 */
export async function propose(connectionId: string, level: number) {
  const user = await requireUser();
  const r = await proposeLevel(user.userId, connectionId, level);
  if (r.ok) revalidatePath(`/c/${connectionId}`);
  return r;
}

/** C-2 提案を承諾する。承諾した瞬間に発効する。 */
export async function accept(connectionId: string, level: number) {
  const user = await requireUser();
  const r = await acceptLevel(user.userId, connectionId, level);
  if (r.ok) revalidatePath(`/c/${connectionId}`);
  return r;
}

/** C-2「今はしない」。**相手には何も伝わらない**(D-5)。 */
export async function dismiss(connectionId: string, level: number) {
  const user = await requireUser();
  const r = await dismissProposal(user.userId, connectionId, level);
  if (r.ok) revalidatePath(`/c/${connectionId}`);
  return r;
}

/** E-1 共有の停止。一方的・即時(D-5)。 */
export async function revoke(connectionId: string, level: number) {
  const user = await requireUser();
  const r = await revokeLevel(user.userId, connectionId, level);
  if (r.ok) revalidatePath(`/c/${connectionId}`);
  return r;
}

/** E-1 恒久化の提案。継続確認(D-2)と同じ双方合意フロー。 */
export async function proposePermanentAction(connectionId: string) {
  const user = await requireUser();
  const r = await proposePermanent(user.userId, connectionId);
  if (r.ok) {
    revalidatePath(`/c/${connectionId}`);
    revalidatePath("/home");
  }
  return r;
}

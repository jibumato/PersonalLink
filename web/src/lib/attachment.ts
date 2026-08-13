import "server-only";

/**
 * 添付ファイル(仕様書 C-1 / 不変条件2)。
 *
 * ## Level 2 ゲート
 *
 * 写真・ファイルは **Lv.2 が解放されている接続でしか送れない**(不変条件2)。
 * 判定はサーバー側で必ず行う。クライアントがボタンを出すかどうかとは無関係に、
 * 送信経路でもう一度確かめる。
 *
 * ## 保管
 *
 * 実体は Postgres に置いている(T-12。理由は schema.ts の attachments を参照)。
 * 取り出しは `/api/a/:id` 経由で、**参加者かどうかを毎回確かめる**。
 * 署名URLのような「URLを知っていれば見られる」形にはしない — 転送されたら終わりになるため。
 */
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  attachments,
  connectionMembers,
  messages,
  MAX_ATTACHMENT_BYTES,
} from "@/db/schema";
import { hasLevel } from "./level";
import { loadChatContext, type MessageView } from "./message";
import { track } from "./analytics";

/** 受け入れる MIME。実行可能なものを弾くため、許可リストで絞る。 */
const IMAGE_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const FILE_MIME = [
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export function kindForMime(mime: string): "image" | "file" | null {
  if (IMAGE_MIME.includes(mime)) return "image";
  if (FILE_MIME.includes(mime)) return "file";
  return null;
}

export type SendAttachmentResult =
  | { ok: true; message: MessageView }
  | { ok: false; error: string };

/**
 * 添付を送る。
 *
 * ゲートの順序が大事: **参加者 → 送信可能な状態 → Lv.2** の順に確かめる。
 * 先に Lv.2 を見ると、参加していない接続についてレベルの有無が分かってしまう。
 */
export async function sendAttachment(
  userId: string,
  connectionId: string,
  file: { mime: string; filename: string; data: Buffer },
  muted: boolean,
): Promise<SendAttachmentResult> {
  const ctx = await loadChatContext(userId, connectionId);
  if (!ctx) return { ok: false, error: "この会話は見つかりません" };
  if (!ctx.canSend) {
    return { ok: false, error: "期限が終了したため、送れません" };
  }

  const kind = kindForMime(file.mime);
  if (!kind) return { ok: false, error: "この形式のファイルは送れません" };
  if (file.data.byteLength === 0) return { ok: false, error: "ファイルが空です" };
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `${MAX_ATTACHMENT_BYTES / 1024 / 1024}MBまで送れます` };
  }

  // 不変条件2。ここが本番の関門
  if (!(await hasLevel(connectionId, 2))) {
    return { ok: false, error: "写真・ファイルの共有(Lv.2)がまだ解放されていません" };
  }

  const db = await getDb();
  const [row] = await db
    .insert(messages)
    .values({
      connectionId,
      senderId: userId,
      kind,
      body: kind === "image" ? null : file.filename,
      muted,
    })
    .returning();

  await db.insert(attachments).values({
    messageId: row.id,
    mime: file.mime,
    filename: file.filename,
    bytes: file.data.byteLength,
    data: file.data,
  });

  track({ name: "attachment_sent", kind, kb: Math.round(file.data.byteLength / 1024) });
  const { toViewForSender } = await import("./message");
  return { ok: true, message: toViewForSender(row, userId, file.filename) };
}

export type AttachmentBlob = {
  mime: string;
  filename: string;
  data: Buffer;
};

/**
 * 添付を取り出す。**参加者でなければ渡さない。**
 *
 * ⚠️ **毎回 Lv.2 を確かめる。** 共有を停止したら、すでに送られた写真も見えなくなる
 * (T-6: 「レベルを下げたのに古いURLで見え続ける」を作らない)。
 * 「停止しても過去のぶんは見られる」なら、停止はほとんど意味を持たない。
 *
 * 取り消し済み(D-12)なら添付はすでに物理削除されているので、
 * そもそも行が無く、ここは null を返す。
 */
export async function loadAttachment(
  userId: string,
  attachmentId: string,
): Promise<AttachmentBlob | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      mime: attachments.mime,
      filename: attachments.filename,
      data: attachments.data,
      connectionId: messages.connectionId,
      deletedBy: messages.deletedBy,
    })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .innerJoin(
      connectionMembers,
      and(
        eq(connectionMembers.connectionId, messages.connectionId),
        eq(connectionMembers.userId, userId),
        isNull(connectionMembers.hiddenAt),
      ),
    )
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  if (!row) return null;
  // 自分の画面から消したものは自分には返さない
  if (row.deletedBy.includes(userId)) return null;
  // グループの添付はレベルに依存しない(D-11)
  if (row.connectionId === null) return { mime: row.mime, filename: row.filename, data: row.data };
  // 停止されていたら、過去のぶんも渡さない(不変条件2)
  if (!(await hasLevel(row.connectionId, 2))) return null;
  return { mime: row.mime, filename: row.filename, data: row.data };
}

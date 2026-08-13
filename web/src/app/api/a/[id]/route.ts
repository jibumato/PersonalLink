import { getCurrentUser } from "@/lib/session";
import { loadAttachment } from "@/lib/attachment";

/**
 * 添付の配信。
 *
 * **毎回、参加者かどうかを確かめる**。署名URLのような「URLを知っていれば見られる」
 * 形にしないのは、転送されたら取り返しがつかないため(憲法第五条)。
 *
 * 見つからない場合と権限がない場合を**同じ404**で返す。区別すると
 * 「そのIDの添付は存在する」ことが分かってしまう。
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 404 });

  const { id } = await params;
  const blob = await loadAttachment(user.userId, id);
  if (!blob) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(blob.data), {
    headers: {
      "content-type": blob.mime,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(blob.filename)}`,
      // 共有キャッシュに載せない。認可付きの応答なので個人に閉じる
      "cache-control": "private, max-age=300",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

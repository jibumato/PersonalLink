import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMessages, loadChatContext, markRead } from "@/lib/message";
import { remainingLabel } from "@/lib/connection";
import { reconcileStatus } from "@/lib/renewal";
import { hasLevel, pendingProposalFor } from "@/lib/level";
import { Chat } from "./chat";

/** C-1 チャット(1対1)。 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  // 読み取り時の遅延評価(T-8)。Cronが遅れていても、開いた時点で正しい状態にする
  await reconcileStatus(id);
  const ctx = await loadChatContext(user.userId, id);
  if (!ctx) notFound();

  const [initial, canAttach, pendingProposal] = await Promise.all([
    listMessages(user.userId, id),
    // 不変条件2。UIのゲートだが、送信経路でもサーバーが必ず再確認する
    hasLevel(id, 2),
    pendingProposalFor(user.userId, id),
    // 開いた時点で既読にする。これは自分の未読バッジ用で、相手には見せない(D-8)
    markRead(user.userId, id),
  ]);

  return (
    <main className="shell chatshell">
      <header className="panel chathead">
        <Link href="/home" className="back" aria-label="ホームへ戻る">‹</Link>
        <span className="grow">
          <span className="name">{ctx.partner.displayName ?? `@${ctx.partner.handle}`}</span>
          <span className="sub mono">@{ctx.partner.handle}</span>
        </span>
        {/* 期限は常に見えるところに置く(D-1) */}
        <span
          className={`badge${
            ctx.status === "expired" ? " badge-done" : ctx.expiresAt ? " badge-warn" : ""
          }`}
        >
          {remainingLabel(ctx.expiresAt)}
        </span>
      </header>

      {/* D-1 期限接近バナー。継続確認への導線を切らさない */}
      {(ctx.expiring || ctx.status === "grace") && (
        <div className="banner">
          <span>
            {ctx.status === "grace"
              ? "⌛ 期限が終了しました。猶予のあいだなら継続できます"
              : "⏳ まもなく期限です"}
          </span>
          <Link href={`/c/${id}/renewal`}>継続確認へ</Link>
        </div>
      )}

      <Chat
        connectionId={id}
        initial={initial}
        canSend={ctx.canSend}
        status={ctx.status}
        canAttach={canAttach}
        pendingProposal={pendingProposal}
      />
    </main>
  );
}

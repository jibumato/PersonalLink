import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listMessages, loadChatContext, markRead } from "@/lib/message";
import { remainingLabel } from "@/lib/connection";
import { Chat } from "./chat";

/** C-1 チャット(1対1)。 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  const ctx = await loadChatContext(user.userId, id);
  if (!ctx) notFound();

  const [initial] = await Promise.all([
    listMessages(user.userId, id),
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
        <span className={`badge${ctx.expiresAt ? " badge-warn" : ""}`}>
          {remainingLabel(ctx.expiresAt)}
        </span>
      </header>

      <Chat
        connectionId={id}
        initial={initial}
        canSend={ctx.canSend}
        status={ctx.status}
      />
    </main>
  );
}

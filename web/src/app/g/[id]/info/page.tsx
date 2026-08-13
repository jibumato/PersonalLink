import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { invitableConnections, loadGroupContext } from "@/lib/group";
import { MemberPanel } from "./member-panel";

/** G-2 のメンバー一覧・招待・退出・削除。 */
export const dynamic = "force-dynamic";

export default async function GroupInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  const ctx = await loadGroupContext(user.userId, id);
  if (!ctx || !ctx.joined) notFound();

  // すでにメンバー(招待中を含む)の人は候補から外す
  const inGroup = new Set(ctx.members.map((m) => m.userId));
  const candidates = (await invitableConnections(user.userId)).filter(
    (c) => !inGroup.has(c.userId),
  );

  return (
    <main className="shell">
      <header className="panel chathead">
        <Link href={`/g/${id}`} className="back" aria-label="会話へ戻る">‹</Link>
        <span className="grow">
          <span className="name">{ctx.name}</span>
          <span className="sub">{ctx.members.filter((m) => m.joined).length}人が参加</span>
        </span>
      </header>

      <MemberPanel
        groupId={id}
        members={ctx.members}
        candidates={candidates}
        isOwner={ctx.isOwner}
        me={user.userId}
      />

      <div className="panel">
        <p className="hint">
          グループでの同席は、1対1のConnectionには影響しません(D-11)。
          レベルも期限もグループには存在せず、1対1が終了した相手ともここでは会話が続きます。
        </p>
      </div>

      <p className="linkrow">
        <Link href={`/g/${id}`}>← 会話に戻る</Link>
      </p>
    </main>
  );
}

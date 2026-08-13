import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listGroupMessages, loadGroupContext, markGroupRead } from "@/lib/group";
import { GroupChat } from "./group-chat";
import { GroupInvite } from "./invite";

/**
 * G-2 グループチャット。
 *
 * **期限もレベルも無い**(D-11)。1対1とは独立した合意の場なので、
 * 1対1が終了した相手ともここでは会話が続く。
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  const ctx = await loadGroupContext(user.userId, id);
  if (!ctx) notFound();

  // 招待中の人には会話を見せない。参加を選んで初めて読める(G-1)
  if (!ctx.joined) {
    return (
      <main className="shell" style={{ justifyContent: "center" }}>
        <div className="panel" style={{ textAlign: "center" }}>
          <p className="eyebrow">Invitation</p>
          <h1>{ctx.name}</h1>
          <p className="lede">
            {ctx.members.filter((m) => m.joined).length}人が参加しています。
            <br />
            参加すると、これまでの会話が読めるようになります。
          </p>
          <div style={{ marginTop: "1.2rem" }}>
            <GroupInvite groupId={id} />
          </div>
        </div>
      </main>
    );
  }

  const [initial] = await Promise.all([
    listGroupMessages(user.userId, id),
    markGroupRead(user.userId, id),
  ]);

  return (
    <main className="shell chatshell">
      <header className="panel chathead">
        <Link href="/home" className="back" aria-label="ホームへ戻る">‹</Link>
        <span className="grow">
          <span className="name">{ctx.name}</span>
          <span className="sub">{ctx.members.filter((m) => m.joined).length}人</span>
        </span>
        <Link href={`/g/${id}/info`} className="badge">メンバー</Link>
      </header>

      <GroupChat groupId={id} initial={initial} />
    </main>
  );
}

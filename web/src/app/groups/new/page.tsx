import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { invitableConnections } from "@/lib/group";
import { NewGroupForm } from "./form";

/**
 * G-1 グループ作成。
 *
 * 招待できるのは**生きている Connection の相手だけ**。
 * 一覧に出ないものは選べない — グループを「知らない人とつながる裏口」にしない。
 */
export const dynamic = "force-dynamic";

export default async function NewGroupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const candidates = await invitableConnections(user.userId);

  return (
    <main className="shell">
      <header className="panel homehead">
        <Link href="/home" className="back" aria-label="ホームへ戻る">‹</Link>
        <div className="grow">
          <div className="name">グループを作る</div>
        </div>
      </header>

      {candidates.length === 0 ? (
        <div className="panel" style={{ textAlign: "center" }}>
          <p className="lede">
            招待できる相手がまだいません。
            <br />
            グループにはつながっている相手だけを招待できます。
          </p>
          <div className="stack" style={{ marginTop: "1.2rem" }}>
            <Link href="/qr" className="btn btn-primary">🔲 QRでつながる</Link>
          </div>
        </div>
      ) : (
        <div className="panel">
          <NewGroupForm candidates={candidates} />
        </div>
      )}
    </main>
  );
}

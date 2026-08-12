import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { loadChatContext } from "@/lib/message";
import { loadMyRenewal, reconcileStatus } from "@/lib/renewal";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { track } from "@/lib/analytics";
import { RenewalForm } from "./renewal-form";

/**
 * D-2 継続確認。**構想書の思想的中核**。
 *
 * 「残したい関係だけ残す」ための意思決定をする画面。
 * ⚠️ 相手が何を選んだかは**一切表示しない**(D-3)。
 */
export default async function RenewalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  // チャットと同じく読み取り時に整合させる(T-8)。Cronが止まっていても表示は正しい
  await reconcileStatus(id);
  const [ctx, renewal] = await Promise.all([
    loadChatContext(user.userId, id),
    loadMyRenewal(user.userId, id),
  ]);
  if (!ctx || !renewal) notFound();

  if (renewal.status === "permanent") {
    return (
      <main className="shell" style={{ justifyContent: "center" }}>
        <div className="panel" style={{ textAlign: "center" }}>
          <p className="eyebrow">Renewal</p>
          <h1>♾ 恒久のConnectionです</h1>
          <p className="lede">
            {ctx.partner.displayName ?? `@${ctx.partner.handle}`} とは期限なしでつながっています。
          </p>
          <div className="stack" style={{ marginTop: "1.2rem" }}>
            <Link href={`/c/${id}`} className="btn btn-secondary">会話に戻る</Link>
          </div>
        </div>
      </main>
    );
  }

  const db = await getDb();
  // ふりかえりに出すのは**自分から見えている数**だけ。相手の閲覧行動は一切集計しない
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.connectionId, id),
        isNull(messages.retractedAt),
        sql`${messages.kind} <> 'system'`,
        sql`not (${user.userId} = any(${messages.deletedBy}))`,
      ),
    );

  // つながってからの日数(仕様書 D-2 の「ふりかえり」)
  const days = Math.max(
    1,
    Math.round((Date.now() - ctx.establishedAt.getTime()) / (24 * 60 * 60 * 1000)),
  );

  // 期限後継続率の分母。誰が見たかは載せない(D-3)
  track({ name: "renewal_viewed", inGrace: renewal.status === "grace", daysSinceConnect: days });

  return (
    <main className="shell">
      <div className="panel" style={{ textAlign: "center" }}>
        <p className="eyebrow">Renewal</p>
        <h1>{ctx.partner.displayName ?? `@${ctx.partner.handle}`}</h1>
        <div className="review">
          <span>
            <b>{days}</b>日 つながった
          </span>
          <span>
            <b>{count}</b>通 やり取りした
          </span>
        </div>
        {renewal.status === "grace" && (
          <p className="notice" style={{ marginTop: ".8rem" }}>
            期限を過ぎています。猶予のあいだ(48時間)なら、まだ継続を選べます。
          </p>
        )}
      </div>

      <div className="panel">
        <h2>{renewal.status === "expired" ? "この接続は終了しました" : "この接続を継続しますか?"}</h2>
        {renewal.status !== "expired" && (
          <p className="lede">
            お互いが「継続」を選ぶと、期限のないConnection(♾恒久)になります。
            継続しない場合、期限が来ると接続は終了します。
            <strong>どちらを選んだかは相手に通知されません。</strong>
          </p>
        )}
        <div style={{ marginTop: "1.2rem" }}>
          <RenewalForm
            connectionId={id}
            myChoice={renewal.myChoice}
            canChoose={renewal.canChoose}
            status={renewal.status}
          />
        </div>
      </div>

      <p className="linkrow">
        <Link href={`/c/${id}`}>← 会話に戻る</Link>
      </p>
    </main>
  );
}

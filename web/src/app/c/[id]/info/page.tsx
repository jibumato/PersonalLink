import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { loadChatContext } from "@/lib/message";
import { loadLevels } from "@/lib/level";
import { reconcileStatus } from "@/lib/renewal";
import { remainingLabel } from "@/lib/connection";
import { getPublicProfile, getDetailProfile } from "@/lib/connection";
import { track } from "@/lib/analytics";
import { LevelPanel } from "./level-panel";
import { DangerZone } from "./danger-zone";

/**
 * E-1 Connection詳細。**この相手との「関係の現在地」**を1画面で見る。
 *
 * 期限(D-1の軸)とレベル(D-5の軸)は独立しているので、両方を並べて置く。
 */
export default async function InfoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const { id } = await params;
  await reconcileStatus(id);
  const [ctx, levels] = await Promise.all([
    loadChatContext(user.userId, id),
    loadLevels(user.userId, id),
  ]);
  if (!ctx || !levels) notFound();

  // Lv.4 が解放されているときだけ、詳細プロフィールを取りに行く。
  // 「取ってから隠す」ではなく「解放されていなければ取らない」
  const l4 = levels.find((l) => l.level === 4)?.granted === true;
  const [publicProfile, detail] = await Promise.all([
    getPublicProfile(ctx.partner.userId),
    l4 ? getDetailProfile(ctx.partner.userId) : Promise.resolve(null),
  ]);

  track({ name: "connection_info_viewed" });
  const name = ctx.partner.displayName ?? `@${ctx.partner.handle}`;

  return (
    <main className="shell">
      <header className="panel chathead">
        <Link href={`/c/${id}`} className="back" aria-label="会話へ戻る">‹</Link>
        <span className="grow">
          <span className="name">{name}</span>
          <span className="sub mono">@{ctx.partner.handle}</span>
        </span>
        <span className={`badge${ctx.status === "expired" ? " badge-done" : ctx.expiresAt ? " badge-warn" : ""}`}>
          {remainingLabel(ctx.expiresAt)}
        </span>
      </header>

      {publicProfile?.bio && (
        <div className="panel">
          <p className="eyebrow">プロフィール</p>
          <p className="lede">{publicProfile.bio}</p>
        </div>
      )}

      {detail && Object.keys(detail).length > 0 && (
        <div className="panel">
          <p className="eyebrow">詳細プロフィール(Lv.4)</p>
          <dl className="deflist">
            {Object.entries(detail).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <LevelPanel
        connectionId={id}
        levels={levels}
        status={ctx.status}
        canAct={ctx.status !== "expired"}
      />

      <DangerZone
        connectionId={id}
        name={name}
        blockedByMe={ctx.blockedByMe}
      />

      <p className="linkrow">
        <Link href={`/c/${id}`}>← 会話に戻る</Link>
      </p>
    </main>
  );
}

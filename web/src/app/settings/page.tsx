import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { listBlocked } from "@/lib/safety";
import { getPreferredExpiryDays } from "@/app/actions/connect";
import { ProfileForm } from "./profile-form";
import { DetailForm } from "./detail-form";
import { BlockList } from "./block-list";
import { DangerSection } from "./danger-section";
import { ExpiryPref } from "./expiry-pref";

/** F-2 設定。プロフィール・QR既定期限・ブロック・データ。 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  const db = await getDb();
  const [me] = await db
    .select({ displayName: profiles.displayName, bio: profiles.bio, detail: profiles.detail })
    .from(profiles)
    .where(eq(profiles.userId, user.userId))
    .limit(1);

  const [blocked, expiryDays] = await Promise.all([
    listBlocked(user.userId),
    getPreferredExpiryDays(),
  ]);

  return (
    <main className="shell">
      <header className="panel homehead">
        <Link href="/home" className="back" aria-label="ホームへ戻る">‹</Link>
        <div className="grow">
          <div className="name">設定</div>
          <div className="mono sub">@{user.handle}</div>
        </div>
      </header>

      <section className="panel">
        <p className="eyebrow">プロフィール(Level 0 / 公開)</p>
        <p className="hint">QRを読み取った相手に見えます。</p>
        <ProfileForm displayName={me?.displayName ?? ""} bio={me?.bio ?? ""} />
      </section>

      <section className="panel">
        <p className="eyebrow">詳細プロフィール(Level 4)</p>
        <p className="hint">
          <strong>Lv.4 を解放した相手にだけ</strong>見えます。すべて任意です。
        </p>
        <DetailForm detail={me?.detail ?? {}} />
      </section>

      <section className="panel">
        <p className="eyebrow">QRの既定期限</p>
        <ExpiryPref current={expiryDays} />
      </section>

      <section className="panel">
        <p className="eyebrow">ブロック</p>
        <BlockList items={blocked} />
      </section>

      <section className="panel">
        <p className="eyebrow">セキュリティ</p>
        <div className="stack">
          <Link href="/settings/devices" className="btn btn-secondary">
            端末・セッション管理
          </Link>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">データ</p>
        <div className="stack">
          {/* 申請ではなくその場でダウンロードできる(憲法第六条) */}
          <a className="btn btn-secondary" href="/api/export" download>
            すべてのデータをダウンロード(JSON)
          </a>
          <p className="hint">
            会話・Connection・ブロックリストを1つのファイルにまとめます。
            相手が継続確認で何を選んだかは含まれません(D-3)。
          </p>
        </div>
      </section>

      <DangerSection />
    </main>
  );
}

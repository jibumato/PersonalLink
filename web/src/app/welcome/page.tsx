import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { devLoginEnabled } from "@/lib/dev-auth";

/** A-1 ウェルカム。 */
export default async function WelcomePage() {
  if (await getCurrentUser()) redirect("/home");

  return (
    <main className="shell" style={{ justifyContent: "center" }}>
      <div className="panel" style={{ textAlign: "center", padding: "2rem 1.4rem" }}>
        <p className="eyebrow">Personal Link</p>
        <h1>LINEを教える前に、つながろう。</h1>
        {/* サブコピーは認証方式が決まるまで確定できない(D-7) */}
        <p className="lede">期限付きで、気軽につながる。</p>
        <div className="stack" style={{ marginTop: "1.6rem" }}>
          <Link href="/signup/id" className="btn btn-primary">はじめる</Link>
          {devLoginEnabled() && (
            <Link href="/dev/login" className="btn btn-ghost">ログイン(開発用)</Link>
          )}
        </div>
      </div>
      <p className="hint" style={{ textAlign: "center" }}>
        ログイン方法は現在検討中です(仕様書 D-7)。
      </p>
    </main>
  );
}

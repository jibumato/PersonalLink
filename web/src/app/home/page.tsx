import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logout } from "@/app/actions/auth";

/**
 * B-1 ホーム。
 * S1 では「ログインできている」ことの確認まで。Connection一覧は S2 で実装する。
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  if (!user.displayName) redirect("/signup/profile");

  return (
    <main className="shell">
      <div className="panel">
        <p className="eyebrow">Home</p>
        <h1>{user.displayName}</h1>
        <p className="lede mono">@{user.handle}</p>
      </div>

      <div className="panel">
        <h2>Connection</h2>
        <p className="lede">
          まだConnectionがありません。QR接続は S2 で実装します。
        </p>
      </div>

      <div className="panel">
        <h2>アカウント</h2>
        <ul className="rows">
          <li>
            <span className="grow">
              端末・セッション管理
              <span className="sub">全端末からログアウトできます</span>
            </span>
            <Link href="/settings/devices" className="badge">開く</Link>
          </li>
        </ul>
        <form action={logout} style={{ marginTop: ".8rem" }}>
          <button type="submit" className="btn btn-ghost">ログアウト</button>
        </form>
      </div>
    </main>
  );
}

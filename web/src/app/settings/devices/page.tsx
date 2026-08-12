import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, listSessions } from "@/lib/session";
import { logoutDevice, logoutEverywhere } from "@/app/actions/auth";

/** F-3 端末・セッション管理。MVP必須機能⑩「全端末ログアウト」を含む。 */
export default async function DevicesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  const sessions = await listSessions(user.userId);

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    }).format(d);

  return (
    <main className="shell">
      <div className="panel">
        <p className="eyebrow">Settings</p>
        <h1>端末・セッション</h1>
        <p className="lede">ログイン中の端末は {sessions.length} 台です。</p>
      </div>

      <div className="panel">
        <h2>ログイン中の端末</h2>
        <ul className="rows">
          {sessions.map((s) => {
            const current = s.id === user.sessionId;
            return (
              <li key={s.id}>
                <span className="grow">
                  {s.deviceLabel ?? "不明な端末"}
                  {current && <> <span className="badge">この端末</span></>}
                  <span className="sub">最終アクセス {fmt(s.lastSeenAt)}</span>
                </span>
                <form action={logoutDevice}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <button type="submit" className="badge badge-warn" style={{ border: 0, cursor: "pointer" }}>
                    ログアウト
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel">
        <h2>全端末からログアウト</h2>
        <p className="lede">
          端末を紛失したときに使います。実行すると、すべての端末で再ログインが必要になります。
        </p>
        <div className="stack" style={{ marginTop: ".9rem" }}>
          <form action={logoutEverywhere}>
            <input type="hidden" name="keepCurrent" value="1" />
            <button type="submit" className="btn btn-secondary">この端末以外からログアウト</button>
          </form>
          <form action={logoutEverywhere}>
            <button type="submit" className="btn btn-danger">すべての端末からログアウト</button>
          </form>
        </div>
      </div>

      <p className="linkrow"><Link href="/home">← ホームへ</Link></p>
    </main>
  );
}

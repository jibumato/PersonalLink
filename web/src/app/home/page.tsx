import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  listConnections,
  remainingDays,
  remainingLabel,
  splitByUrgency,
  type ConnectionListItem,
} from "@/lib/connection";
import { unreadCounts } from "@/lib/message";
import { logout } from "@/app/actions/auth";
import { Established } from "./established";

/** B-1 ホーム(Connection一覧)。すべての起点。 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ established?: string; already?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  if (!user.displayName) redirect("/signup/profile");

  const { established, already } = await searchParams;
  const [items, unread] = await Promise.all([
    listConnections(user.userId),
    unreadCounts(user.userId),
  ]);
  const justConnected = established ? items.find((i) => i.id === established) : undefined;

  const { expiring, rest } = splitByUrgency(items);
  const rows = (list: ConnectionListItem[]) => <ConnectionRows items={list} unread={unread} />;

  return (
    <main className="shell">
      <header className="panel homehead">
        <div className="grow">
          <div className="name">{user.displayName}</div>
          <div className="mono sub">@{user.handle}</div>
        </div>
        <Link href="/settings/devices" className="badge">設定</Link>
      </header>

      {already && <p className="notice">すでにつながっています。</p>}

      {items.length === 0 ? (
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>Connection</h2>
          <p className="lede">
            まだConnectionがありません。
            <br />
            イベントで会った人にQRを見せてみましょう。
          </p>
        </div>
      ) : (
        <>
          {expiring.length > 0 && (
            <section className="panel">
              <p className="eyebrow">まもなく期限</p>
              {rows(expiring)}
            </section>
          )}
          {rest.length > 0 && (
            <section className="panel">
              <p className="eyebrow">つながり中</p>
              {rows(rest)}
            </section>
          )}
        </>
      )}

      <div className="panel">
        <form action={logout}>
          <button type="submit" className="btn btn-ghost">ログアウト</button>
        </form>
      </div>

      {/* B-2/B-3 への最重要導線。画面下部に固定する */}
      <Link href="/qr" className="fab">🔲 QR</Link>

      {justConnected && (
        <Established
          name={justConnected.partner.displayName ?? `@${justConnected.partner.handle}`}
          days={remainingDays(justConnected.expiresAt)}
          connectionId={justConnected.id}
        />
      )}
    </main>
  );
}

function ConnectionRows({
  items,
  unread,
}: {
  items: ConnectionListItem[];
  unread: Map<string, number>;
}) {
  return (
    <ul className="rows">
      {items.map((c) => {
        const n = unread.get(c.id) ?? 0;
        return (
          <li key={c.id}>
            <Link href={`/c/${c.id}`} className="rowlink">
              <span className="grow">
                <span className="name">{c.partner.displayName ?? `@${c.partner.handle}`}</span>
                <span className="sub mono">@{c.partner.handle}</span>
              </span>
              {/* 未読は自分の情報。相手には見せない(D-8) */}
              {n > 0 && <span className="badge unread">{n}</span>}
              <span className={`badge${c.expiresAt ? " badge-warn" : ""}`}>
                {remainingLabel(c.expiresAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

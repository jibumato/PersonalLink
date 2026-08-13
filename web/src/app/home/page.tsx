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
  searchParams: Promise<{ established?: string; already?: string; tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  if (!user.displayName) redirect("/signup/profile");

  const { established, already, tab } = await searchParams;
  const [items, unread] = await Promise.all([
    listConnections(user.userId),
    unreadCounts(user.userId),
  ]);
  const justConnected = established ? items.find((i) => i.id === established) : undefined;

  // 終了済みは別タブへ(B-1)。生きている接続に混ぜると、終わったものが
  // 「まもなく期限」に居座り続けて一覧が読めなくなる
  const ended = items.filter((i) => i.status === "expired");
  const alive = items.filter((i) => i.status !== "expired");
  const showEnded = tab === "ended";
  const { expiring, rest } = splitByUrgency(alive);
  const rows = (list: ConnectionListItem[]) => <ConnectionRows items={list} unread={unread} />;

  return (
    <main className="shell">
      <header className="panel homehead">
        <div className="grow">
          <div className="name">{user.displayName}</div>
          <div className="mono sub">@{user.handle}</div>
        </div>
        <Link href="/settings" className="badge">設定</Link>
      </header>

      {already && <p className="notice">すでにつながっています。</p>}

      {ended.length > 0 && (
        <nav className="tabs" aria-label="Connectionの表示切り替え">
          <Link href="/home" className={`tab${showEnded ? "" : " on"}`} aria-current={!showEnded}>
            つながり中
          </Link>
          <Link
            href="/home?tab=ended"
            className={`tab${showEnded ? " on" : ""}`}
            aria-current={showEnded}
          >
            終了済み({ended.length})
          </Link>
        </nav>
      )}

      {showEnded ? (
        <section className="panel">
          <p className="eyebrow">終了済み</p>
          <p className="hint">閲覧のみ。開いて履歴を削除できます。</p>
          {rows(ended)}
        </section>
      ) : alive.length === 0 ? (
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>Connection</h2>
          <p className="lede">
            {ended.length > 0 ? (
              <>
                つながり中のConnectionはありません。
                <br />
                また会った人にQRを見せてみましょう。
              </>
            ) : (
              <>
                まだConnectionがありません。
                <br />
                イベントで会った人にQRを見せてみましょう。
              </>
            )}
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

/** 終了済みは落ち着いた色に。生きている期限だけを警告色で見せる */
function badgeTone(c: ConnectionListItem): string {
  if (c.status === "expired") return " badge-done";
  return c.expiresAt ? " badge-warn" : "";
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
              <span className={`badge${badgeTone(c)}`}>{remainingLabel(c.expiresAt)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

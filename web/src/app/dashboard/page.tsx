import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canViewDashboard } from "@/lib/admin";
import { formatRate, kpiReport } from "@/lib/kpi";

/**
 * KPIダッシュボード(仕様書 §6 / 構想書 §16)。
 *
 * **計測用のテーブルを持たず、運用テーブルから集計している**([kpi.ts](../../lib/kpi.ts))。
 * だからここには本文が出しようがない。
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  if (!canViewDashboard(user.handle)) notFound();

  const report = await kpiReport();
  const ov = report.overview;

  return (
    <main className="shell">
      <header className="panel homehead">
        <Link href="/home" className="back" aria-label="ホームへ戻る">‹</Link>
        <div className="grow">
          <div className="name">KPIダッシュボード</div>
          <div className="mono sub">
            {new Date(report.generatedAt).toLocaleString("ja-JP")}
          </div>
        </div>
      </header>

      <section className="panel">
        <p className="eyebrow">Overview</p>
        <div className="statgrid">
          <Stat label="ユーザー" value={ov.users} />
          <Stat label="Connection" value={ov.connections} />
          <Stat label="♾ 恒久" value={ov.permanent} />
          <Stat label="終了" value={ov.expired} />
          <Stat label="グループ" value={ov.groups} />
          <Stat label="メッセージ" value={ov.messages} />
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">KPI</p>
        <ul className="rows">
          {report.metrics.map((m) => (
            <li key={m.key}>
              <span className="grow">
                <span className="name">{m.label}</span>
                <span className="sub">
                  {m.numerator} / {m.denominator}
                  {m.note ? ` — ${m.note}` : ""}
                </span>
              </span>
              <span className="kpival mono">{formatRate(m)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <p className="eyebrow">読み方</p>
        <p className="hint">
          <strong>期限後継続率は高いほど良いわけではありません。</strong>
          100%なら期限機能が無意味、0%なら関係が育っていない。
          「残したい関係だけ残る」中間帯(仮に20〜40%)が健全という仮説を検証するための数字です。
          <br />
          <br />
          QR接続率は<strong>100%を超えることがあります</strong>。
          1回のQR表示で複数人とつながれるためで、イベントではむしろ良い兆候です。
          <br />
          <br />
          定義と近似の詳細は <code>docs/analytics-events.md</code> にあります。
          この画面は集計値だけを扱い、メッセージ本文は一切読みません(D-10)。
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="statv mono">{value}</span>
      <span className="statl">{label}</span>
    </div>
  );
}

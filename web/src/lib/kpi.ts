import "server-only";

/**
 * KPI集計(構想書 §16 / 仕様書 §6)。
 *
 * ## 計測のために新しくデータを溜めない
 *
 * KPI用のイベントテーブルを作っていない。5指標はすべて
 * **運用テーブル(connections / messages / qr_tokens)からの集計で出せる**ため。
 *
 * この選択は都合ではなく方針:
 *
 * - 溜めない情報は漏れない(憲法第二条)
 * - **本文が計測に混ざりようがない** — ここのクエリは `body` を一度も SELECT しない
 * - 「誰が何をしたか」の行動ログという資産を作らない。作れば必ず使いたくなる
 *
 * [track()](./analytics.ts) は運用ログとして残すが、集計の正はこちら。
 *
 * ## 定義の近似は隠さない
 *
 * 「QR表示セッション」のように、記録から厳密には出せないものがある。
 * どう近似したかは [docs/analytics-events.md](../../../docs/analytics-events.md) に書く。
 * 分子・分母の生数も一緒に返すので、率だけを見て誤解しなくて済む。
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** 同じ人の連続したQR発行を1回の「表示」とみなす間隔。 */
export const QR_SESSION_GAP_MINUTES = 10;

export type Metric = {
  key: string;
  label: string;
  /** 分子 / 分母。母数が0なら率は出さない */
  numerator: number;
  denominator: number;
  /** 母数が0のときの理由。「まだ測れない」を率0%と偽らない */
  note?: string;
};

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const db = await getDb();
  const res = await db.execute(query);
  const raw = res as unknown as T[] | { rows: T[] };
  return Array.isArray(raw) ? raw : raw.rows;
}

/**
 * **QR接続率** = 成立数 ÷ QR表示セッション数。
 *
 * QRは5分ごとに自動更新されるので、トークンを数えると表示回数を大きく上回る。
 * 同じ人の連続発行を10分の間隔で束ねて1回の表示とみなす。
 *
 * ⚠️ **100%を超えうる。** 1回の表示で複数人とつながれるため(イベントでは良い兆候)。
 */
async function qrConnectRate(): Promise<Metric> {
  const [s] = await rows<{ sessions: number }>(sql`
    with t as (
      select user_id, issued_at,
        lag(issued_at) over (partition by user_id order by issued_at) as prev
      from qr_tokens
    )
    select count(*)::int as sessions from t
    where prev is null
       or issued_at - prev > (${QR_SESSION_GAP_MINUTES} || ' minutes')::interval
  `);
  const [c] = await rows<{ established: number }>(
    sql`select count(*)::int as established from connections`,
  );
  return {
    key: "qr_connect_rate",
    label: "QR接続率",
    numerator: c.established,
    denominator: s.sessions,
    note: s.sessions === 0 ? "QRがまだ表示されていません" : undefined,
  };
}

/** **初回メッセージ率** = 成立後24時間以内に双方向のやり取りがあった Connection の割合。 */
async function firstMessageRate(): Promise<Metric> {
  const [r] = await rows<{ bidirectional: number; total: number }>(sql`
    select
      (select count(*)::int from (
        select c.id
        from connections c
        join messages m
          on m.connection_id = c.id
         and m.kind <> 'system'
         and m.created_at < c.established_at + interval '24 hours'
        group by c.id
        having count(distinct m.sender_id) >= 2
      ) x) as bidirectional,
      (select count(*)::int from connections) as total
  `);
  return {
    key: "first_message_rate",
    label: "初回メッセージ率",
    numerator: r.bidirectional,
    denominator: r.total,
    note: r.total === 0 ? "Connectionがまだありません" : undefined,
  };
}

/**
 * **期限後継続率** = 恒久になった数 ÷ 継続確認に至った Connection 数。
 *
 * 分母は「期限が来た(grace / expired)」か「継続確認で誰かが選んだ」もの。
 * 期限前に恒久化したものは分母に入れない — 期限に到達していないため。
 */
async function renewalRate(): Promise<Metric> {
  const [r] = await rows<{ continued: number; reached: number }>(sql`
    select
      count(*) filter (where status = 'permanent')::int as continued,
      count(*)::int as reached
    from connections c
    where c.status in ('grace', 'expired')
       or exists (select 1 from renewal_choices r where r.connection_id = c.id)
  `);
  return {
    key: "renewal_rate",
    label: "期限後継続率",
    numerator: r.continued,
    denominator: r.reached,
    note: r.reached === 0 ? "まだ期限に到達したConnectionがありません" : undefined,
  };
}

/** **再利用率** = 初回接続から7日以内に、もう一度QRを使った人の割合。 */
async function reuseRate(): Promise<Metric> {
  const [r] = await rows<{ reused: number; total: number }>(sql`
    with firsts as (
      select cm.user_id, min(c.established_at) as first_at
      from connection_members cm
      join connections c on c.id = cm.connection_id
      group by cm.user_id
    ),
    flagged as (
      select f.user_id,
        (
          exists (
            select 1 from qr_tokens q
            where q.user_id = f.user_id
              and q.issued_at > f.first_at
              and q.issued_at <= f.first_at + interval '7 days'
          )
          or exists (
            select 1 from qr_tokens q2
            where q2.consumed_by = f.user_id
              and q2.consumed_at > f.first_at
              and q2.consumed_at <= f.first_at + interval '7 days'
          )
        ) as reused
      from firsts f
    )
    select count(*) filter (where reused)::int as reused, count(*)::int as total from flagged
  `);
  return {
    key: "reuse_rate",
    label: "再利用率",
    numerator: r.reused,
    denominator: r.total,
    note: r.total === 0 ? "まだ接続したユーザーがいません" : undefined,
  };
}

/**
 * **LINE移行率の代理指標** = 恒久化から30日たった Connection のうち、
 * 直近30日にやり取りがあった割合(「会話がここに残っているか」)。
 *
 * 本文は一切見ない(D-10)。もう一方の代理指標である終了時アンケートは未実装。
 */
async function retentionRate(): Promise<Metric> {
  const [r] = await rows<{ active: number; matured: number }>(sql`
    select
      count(*) filter (
        where exists (
          select 1 from messages m
          where m.connection_id = c.id
            and m.kind <> 'system'
            and m.created_at > now() - interval '30 days'
        )
      )::int as active,
      count(*)::int as matured
    from connections c
    where c.permanent_at is not null
      and c.permanent_at < now() - interval '30 days'
  `);
  return {
    key: "retention_rate",
    label: "恒久化後30日の継続率(LINE移行率の代理)",
    numerator: r.active,
    denominator: r.matured,
    note:
      r.matured === 0
        ? "恒久化から30日たったConnectionがまだありません。アンケート側の指標はM8で実施"
        : undefined,
  };
}

export type Overview = {
  users: number;
  connections: number;
  permanent: number;
  expired: number;
  groups: number;
  messages: number;
};

/** 率だけでは読み違えるので、母数になる実数も並べる。 */
async function overview(): Promise<Overview> {
  const [r] = await rows<Overview>(sql`
    select
      (select count(*)::int from users where deleted_at is null) as users,
      (select count(*)::int from connections) as connections,
      (select count(*)::int from connections where status = 'permanent') as permanent,
      (select count(*)::int from connections where status = 'expired') as expired,
      (select count(*)::int from groups where deleted_at is null) as groups,
      (select count(*)::int from messages where kind <> 'system') as messages
  `);
  return r;
}

export type KpiReport = {
  generatedAt: string;
  overview: Overview;
  metrics: Metric[];
};

/**
 * KPI 5指標(仕様書 §6)。
 *
 * ⚠️ **本文を一度も読まない。** すべて count なので、
 * この関数の返り値にメッセージ本文が混ざることは構造上ありえない。
 */
export async function kpiReport(): Promise<KpiReport> {
  const [ov, ...metrics] = await Promise.all([
    overview(),
    qrConnectRate(),
    firstMessageRate(),
    renewalRate(),
    reuseRate(),
    retentionRate(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    overview: ov as Overview,
    metrics: metrics as Metric[],
  };
}

/** 率の表示。母数0のときは「—」にする(0%と区別する)。 */
export function formatRate(m: Metric): string {
  if (m.denominator === 0) return "—";
  return `${Math.round((m.numerator / m.denominator) * 1000) / 10}%`;
}

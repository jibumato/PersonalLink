import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connections, profiles, qrTokens, users } from "@/db/schema";
import { establishConnection } from "@/lib/connection";
import { sendMessage } from "@/lib/message";
import { chooseRenewal } from "@/lib/renewal";
import { formatRate, kpiReport } from "@/lib/kpi";
import { canViewDashboard } from "@/lib/admin";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `kpi_user_${n++}` })
    .returning({ id: users.id });
  await db.insert(profiles).values({ userId: u.id, displayName: name });
  return u.id;
}

const metric = (r: Awaited<ReturnType<typeof kpiReport>>, key: string) =>
  r.metrics.find((m) => m.key === key)!;

beforeAll(async () => {
  db = await getDb();
});

describe("KPI集計", () => {
  it("5指標がそろっている(仕様書 §6)", async () => {
    const r = await kpiReport();
    expect(r.metrics.map((m) => m.key)).toEqual([
      "qr_connect_rate",
      "first_message_rate",
      "renewal_rate",
      "reuse_rate",
      "retention_rate",
    ]);
  });

  it("母数が0のときは0%ではなく「—」にする", () => {
    expect(formatRate({ key: "x", label: "x", numerator: 0, denominator: 0 })).toBe("—");
    expect(formatRate({ key: "x", label: "x", numerator: 1, denominator: 4 })).toBe("25%");
  });

  it("双方向のやり取りがあった Connection だけを初回メッセージ率に数える", async () => {
    const before = metric(await kpiReport(), "first_message_rate");

    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const one = await establishConnection(a, b, 7);
    if (!one.ok) throw new Error("setup failed");
    // 片方向だけ
    await sendMessage(a, one.connectionId, "こんにちは", false);

    const mid = metric(await kpiReport(), "first_message_rate");
    expect(mid.denominator).toBe(before.denominator + 1);
    expect(mid.numerator).toBe(before.numerator);

    // 返事が来ると双方向になる
    await sendMessage(b, one.connectionId, "こんにちは!", false);
    const after = metric(await kpiReport(), "first_message_rate");
    expect(after.numerator).toBe(before.numerator + 1);
  });

  it("24時間を過ぎてからの返信は初回メッセージ率に入らない", async () => {
    const before = metric(await kpiReport(), "first_message_rate");

    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const r = await establishConnection(a, b, 7);
    if (!r.ok) throw new Error("setup failed");
    // 成立を2日前にずらす = いま送る返信は24時間の外
    await db
      .update(connections)
      .set({ establishedAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(connections.id, r.connectionId));

    await sendMessage(a, r.connectionId, "遅れて話す", false);
    await sendMessage(b, r.connectionId, "遅れて返す", false);

    const after = metric(await kpiReport(), "first_message_rate");
    expect(after.numerator).toBe(before.numerator);
  });

  it("QRの自動更新は1回の表示として束ねる", async () => {
    const before = metric(await kpiReport(), "qr_connect_rate");
    const u = await newUser("QRの人");

    // 5分間隔で3回発行 = 自動更新1セッション
    for (const min of [0, 5, 10]) {
      await db.insert(qrTokens).values({
        userId: u,
        expiryDays: 7,
        issuedAt: new Date(Date.now() - (30 - min) * 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
      });
    }
    const oneSession = metric(await kpiReport(), "qr_connect_rate");
    expect(oneSession.denominator).toBe(before.denominator + 1);

    // 1時間後にもう一度出す = 別のセッション
    await db.insert(qrTokens).values({
      userId: u,
      expiryDays: 7,
      issuedAt: new Date(Date.now() + 3600_000),
      expiresAt: new Date(Date.now() + 7200_000),
    });
    const twoSessions = metric(await kpiReport(), "qr_connect_rate");
    expect(twoSessions.denominator).toBe(before.denominator + 2);
  });

  it("期限前に恒久化したものは期限後継続率の母数に入る(継続確認を経ているため)", async () => {
    const before = metric(await kpiReport(), "renewal_rate");

    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const r = await establishConnection(a, b, 7);
    if (!r.ok) throw new Error("setup failed");
    await db
      .update(connections)
      .set({
        expiresAt: new Date(Date.now() + 3600_000),
        graceUntil: new Date(Date.now() + 49 * 3600_000),
      })
      .where(eq(connections.id, r.connectionId));

    await chooseRenewal(a, r.connectionId, "continue");
    await chooseRenewal(b, r.connectionId, "continue");

    const after = metric(await kpiReport(), "renewal_rate");
    expect(after.denominator).toBe(before.denominator + 1);
    expect(after.numerator).toBe(before.numerator + 1);
  });

  it("何も起きていない Connection は継続率の母数に入らない", async () => {
    const before = metric(await kpiReport(), "renewal_rate");
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    await establishConnection(a, b, 7);
    expect(metric(await kpiReport(), "renewal_rate").denominator).toBe(before.denominator);
  });
});

describe("D-10: 計測に本文が混ざらない", () => {
  it("集計結果のどこにもメッセージ本文が出てこない", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const r = await establishConnection(a, b, 7);
    if (!r.ok) throw new Error("setup failed");
    const secret = "これは計測に出てはいけない本文です";
    await sendMessage(a, r.connectionId, secret, false);

    const report = await kpiReport();
    expect(JSON.stringify(report)).not.toContain(secret);
    // 数字とラベルしか無い
    for (const m of report.metrics) {
      expect(typeof m.numerator).toBe("number");
      expect(typeof m.denominator).toBe("number");
    }
  });

  it("集計結果に個人の識別子が含まれない", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    await establishConnection(a, b, 7);

    const json = JSON.stringify(await kpiReport());
    expect(json).not.toContain(a);
    expect(json).not.toContain(b);
    expect(json).not.toContain("kpi_user_");
  });
});

describe("ダッシュボードの閲覧権限", () => {
  /**
   * process.env は値を文字列に強制するので、undefined を代入すると
   * 文字列 "undefined" になってしまう。未設定にしたいときは delete する。
   */
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const original = { ...process.env };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      fn();
    } finally {
      process.env = original;
    }
  };

  it("ローカル・プレビューでは開いている", () => {
    withEnv({ VERCEL_ENV: undefined, PL_ADMIN_HANDLES: undefined }, () => {
      expect(canViewDashboard("anyone")).toBe(true);
    });
    withEnv({ VERCEL_ENV: "preview", PL_ADMIN_HANDLES: undefined }, () => {
      expect(canViewDashboard("anyone")).toBe(true);
    });
  });

  it("本番で未設定なら誰も見られない(設定漏れが全開放にならない)", () => {
    withEnv({ VERCEL_ENV: "production", PL_ADMIN_HANDLES: undefined }, () => {
      expect(canViewDashboard("owner")).toBe(false);
      expect(canViewDashboard(null)).toBe(false);
    });
  });

  it("許可リストがあれば、載っている @ID だけ(環境を問わず)", () => {
    for (const env of ["production", "preview", undefined]) {
      withEnv({ VERCEL_ENV: env, PL_ADMIN_HANDLES: "owner, second" }, () => {
        expect(canViewDashboard("owner")).toBe(true);
        expect(canViewDashboard("second")).toBe(true);
        expect(canViewDashboard("stranger")).toBe(false);
        expect(canViewDashboard(null)).toBe(false);
      });
    }
  });
});

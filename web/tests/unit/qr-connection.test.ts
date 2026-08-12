import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connectionMembers, connections, pairKeyOf, qrTokens, users } from "@/db/schema";
import { consumeQrToken, decodeToken, encodeToken, issueQrToken, lookupQrToken } from "@/lib/qr";
import {
  establishConnection,
  findAliveConnection,
  listConnections,
  remainingDays,
  remainingLabel,
  splitByUrgency,
} from "@/lib/connection";
import { profiles } from "@/db/schema";

let db: Database;
let n = 0;
const newUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ handle: `qr_user_${n++}` })
    .returning({ id: users.id });
  return u.id;
};

beforeAll(async () => {
  db = await getDb();
});

describe("QRトークンの署名", () => {
  it("往復できる", () => {
    const id = "0f2b1a9c-1111-2222-3333-444455556666";
    expect(decodeToken(encodeToken(id))).toBe(id);
  });

  it("署名を改ざんすると拒否される", () => {
    const id = "0f2b1a9c-1111-2222-3333-444455556666";
    const token = encodeToken(id);
    const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
    expect(decodeToken(tampered)).toBeNull();
  });

  it("IDを差し替えると拒否される(他人のトークンを騙れない)", () => {
    const token = encodeToken("0f2b1a9c-1111-2222-3333-444455556666");
    const mac = token.slice(token.lastIndexOf("."));
    expect(decodeToken(`99999999-1111-2222-3333-444455556666${mac}`)).toBeNull();
  });

  it("形式が壊れていれば拒否される", () => {
    for (const bad of ["", ".", "abc", "abc."]) expect(decodeToken(bad)).toBeNull();
  });
});

describe("QRトークンのライフサイクル", () => {
  it("発行直後は有効", async () => {
    const owner = await newUser();
    const { payload } = await issueQrToken(owner, 7);
    const found = await lookupQrToken(payload);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.ownerId).toBe(owner);
      expect(found.expiryDays).toBe(7);
    }
  });

  it("使い切り: 2人目は消費できない(同時読み取りで二重成立しない)", async () => {
    const owner = await newUser();
    const first = await newUser();
    const second = await newUser();
    const { payload } = await issueQrToken(owner, 7);
    const tokenId = decodeToken(payload)!;

    expect(await consumeQrToken(tokenId, first)).toBe(true);
    expect(await consumeQrToken(tokenId, second)).toBe(false);

    const after = await lookupQrToken(payload);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe("consumed");
  });

  it("失効したトークンは使えない", async () => {
    const owner = await newUser();
    const { payload } = await issueQrToken(owner, 7);
    const tokenId = decodeToken(payload)!;
    await db
      .update(qrTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(qrTokens.id, tokenId));

    const found = await lookupQrToken(payload);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toBe("expired");
    // 失効後は消費もできない
    expect(await consumeQrToken(tokenId, await newUser())).toBe(false);
  });

  it("期限は 1 / 7 / 30 日のみ(DBのCHECK制約)", async () => {
    const owner = await newUser();
    await expect(
      db.insert(qrTokens).values({
        userId: owner,
        expiryDays: 3,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();
  });
});

describe("Connection の成立", () => {
  it("成立すると2人分のメンバー行ができ、期限が入る", async () => {
    const a = await newUser();
    const b = await newUser();
    const r = await establishConnection(a, b, 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const members = await db
      .select()
      .from(connectionMembers)
      .where(eq(connectionMembers.connectionId, r.connectionId));
    expect(members).toHaveLength(2);

    const days = (r.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("自分自身とはつながれない", async () => {
    const a = await newUser();
    const r = await establishConnection(a, a, 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("self");
  });

  it("同じペアで2つ目は作れない(不変条件7)", async () => {
    const a = await newUser();
    const b = await newUser();
    expect((await establishConnection(a, b, 7)).ok).toBe(true);

    const again = await establishConnection(a, b, 7);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("already_connected");

    // 逆順でも同じペアとして扱われる
    const reversed = await establishConnection(b, a, 30);
    expect(reversed.ok).toBe(false);
  });

  it("終了(expired)したあとは、同じ相手と新しく接続できる", async () => {
    const a = await newUser();
    const b = await newUser();
    const first = await establishConnection(a, b, 7);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await db
      .update(connections)
      .set({ status: "expired", expiresAt: new Date(), endedAt: new Date() })
      .where(eq(connections.id, first.connectionId));

    const second = await establishConnection(a, b, 7);
    expect(second.ok).toBe(true);
    // 履歴は引き継がず、別のConnectionになる(仕様書 D-3)
    if (second.ok) expect(second.connectionId).not.toBe(first.connectionId);
  });

  it("pairKey は順序に依存しない", () => {
    expect(pairKeyOf("b", "a")).toBe(pairKeyOf("a", "b"));
  });
});

describe("DB制約: connections", () => {
  it("恒久なのに期限があると拒否される(不変条件3)", async () => {
    await expect(
      db.insert(connections).values({
        pairKey: "invalid-1",
        status: "permanent",
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });

  it("activeなのに期限が無いと拒否される(不変条件3の裏)", async () => {
    await expect(
      db.insert(connections).values({ pairKey: "invalid-2", status: "active", expiresAt: null }),
    ).rejects.toThrow();
  });

  it("恒久(expires_at = NULL)は作れる", async () => {
    await expect(
      db.insert(connections).values({ pairKey: "valid-permanent", status: "permanent" }),
    ).resolves.toBeDefined();
  });
});

describe("findAliveConnection", () => {
  it("expired は生きているとみなさない", async () => {
    const a = await newUser();
    const b = await newUser();
    const r = await establishConnection(a, b, 7);
    if (!r.ok) throw new Error("setup failed");

    expect(await findAliveConnection(a, b)).not.toBeNull();
    await db
      .update(connections)
      .set({ status: "expired", expiresAt: new Date() })
      .where(eq(connections.id, r.connectionId));
    expect(await findAliveConnection(a, b)).toBeNull();
  });
});

describe("listConnections", () => {
  it("相手の情報が返る(自分ではない側)", async () => {
    const me = await newUser();
    const other = await newUser();
    await db.insert(profiles).values({ userId: other, displayName: "相手さん", bio: "よろしく" });
    await db.insert(profiles).values({ userId: me, displayName: "自分" });
    const r = await establishConnection(me, other, 7);
    if (!r.ok) throw new Error("setup failed");

    const list = await listConnections(me);
    const item = list.find((i) => i.id === r.connectionId);
    expect(item).toBeDefined();
    // ここを間違えると自分自身が「相手」として出てしまう
    expect(item!.partner.displayName).toBe("相手さん");
    expect(item!.partner.bio).toBe("よろしく");
    expect(item!.expiresAt).not.toBeNull();

    // 相手側から見ると自分が出る
    const theirs = await listConnections(other);
    expect(theirs.find((i) => i.id === r.connectionId)!.partner.displayName).toBe("自分");
  });

  it("自分が隠したConnectionは出ない(相手側には残る)", async () => {
    const me = await newUser();
    const other = await newUser();
    const r = await establishConnection(me, other, 7);
    if (!r.ok) throw new Error("setup failed");

    await db
      .update(connectionMembers)
      .set({ hiddenAt: new Date() })
      .where(
        and(eq(connectionMembers.connectionId, r.connectionId), eq(connectionMembers.userId, me)),
      );

    expect((await listConnections(me)).some((i) => i.id === r.connectionId)).toBe(false);
    expect((await listConnections(other)).some((i) => i.id === r.connectionId)).toBe(true);
  });

  it("無関係の人のConnectionは見えない", async () => {
    const a = await newUser();
    const b = await newUser();
    const stranger = await newUser();
    await establishConnection(a, b, 7);
    expect(await listConnections(stranger)).toHaveLength(0);
  });
});

describe("splitByUrgency", () => {
  const item = (expiresAt: Date | null) => ({
    id: "x",
    status: "active" as const,
    expiresAt,
    establishedAt: new Date(),
    partner: { handle: "h", displayName: null, bio: null },
  });

  it("残り24時間未満は「まもなく期限」に入る", () => {
    const now = Date.now();
    const soon = item(new Date(now + 3 * 60 * 60 * 1000));
    const later = item(new Date(now + 5 * 24 * 60 * 60 * 1000));
    const forever = item(null);
    const { expiring, rest } = splitByUrgency([soon, later, forever], now);
    expect(expiring).toEqual([soon]);
    expect(rest).toEqual([later, forever]);
  });
});

describe("remainingDays", () => {
  it("恒久は null", () => expect(remainingDays(null)).toBeNull());
  it("最低でも1日と表示する(0日にしない)", () => {
    const now = Date.now();
    expect(remainingDays(new Date(now + 60 * 1000), now)).toBe(1);
  });
});

describe("remainingLabel", () => {
  const inHours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

  it("恒久は ♾ で表す(D-1)", () => {
    expect(remainingLabel(null)).toContain("♾");
  });

  it("48時間以上は日数、未満は時間で表す", () => {
    expect(remainingLabel(inHours(24 * 7))).toBe("⏳ 残り7日");
    expect(remainingLabel(inHours(30))).toBe("⏳ 残り30時間");
  });

  it("過ぎていれば期限終了", () => {
    expect(remainingLabel(inHours(-1))).toBe("期限終了");
  });
});

describe("計測", () => {
  it("qr_tokens は本文のような自由文字列カラムを持たない(憲法第二条)", async () => {
    const cols = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'qr_tokens'`,
    );
    const names = (cols as unknown as { rows?: { column_name: string }[] }).rows ??
      (cols as unknown as { column_name: string }[]);
    const list = Array.isArray(names) ? names.map((r) => r.column_name) : [];
    expect(list.sort()).toEqual(
      ["consumed_at", "consumed_by", "expires_at", "expiry_days", "id", "issued_at", "user_id"],
    );
  });
});

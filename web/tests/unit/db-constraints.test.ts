import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { profiles, sessions, users } from "@/db/schema";

/**
 * **不変条件がDBに刻まれていること**を、実際の PostgreSQL(PGlite)に対して検証する(T-3)。
 *
 * アプリのif文はうっかり回避されうるが、DB制約は回避できない。
 * ここが green である限り、どの経路からデータが入っても壊れない。
 */
let db: Database;

beforeAll(async () => {
  db = await getDb();
});

async function newUser(handle: string) {
  const [u] = await db.insert(users).values({ handle }).returning({ id: users.id });
  return u.id;
}

describe("users.handle", () => {
  it("形式違反をDBが拒否する(APIを経由しなくても壊れない)", async () => {
    for (const bad of ["ab", "a".repeat(21), "Satoshi", "sato-shi", "さとし", "sato shi"]) {
      await expect(db.insert(users).values({ handle: bad }), bad).rejects.toThrow();
    }
  });

  it("重複を拒否する", async () => {
    await newUser("dup_test");
    await expect(db.insert(users).values({ handle: "dup_test" })).rejects.toThrow();
  });

  it("削除済みユーザーの handle は再取得できる(部分UNIQUEが効いている)", async () => {
    const id = await newUser("released_one");
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
    // 生存ユーザーだけを対象にした UNIQUE なので、削除後は同じ handle を作れる
    await expect(db.insert(users).values({ handle: "released_one" })).resolves.toBeDefined();
  });
});

describe("外部キーとカスケード", () => {
  it("ユーザーを消すとセッションとプロフィールも消える(憲法第六条)", async () => {
    const id = await newUser("cascade_test");
    await db.insert(profiles).values({ userId: id, displayName: "テスト" });
    await db.insert(sessions).values({
      userId: id,
      tokenHash: "hash-cascade",
      expiresAt: new Date(Date.now() + 1000),
    });

    await db.delete(users).where(eq(users.id, id));

    expect(await db.select().from(profiles).where(eq(profiles.userId, id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(0);
  });

  it("存在しないユーザーのセッションは作れない", async () => {
    await expect(
      db.insert(sessions).values({
        userId: "00000000-0000-0000-0000-000000000000",
        tokenHash: "hash-orphan",
        expiresAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe("sessions.token_hash", () => {
  it("同じトークンハッシュを二重登録できない", async () => {
    const id = await newUser("token_test");
    const values = {
      userId: id,
      tokenHash: "hash-unique",
      expiresAt: new Date(Date.now() + 1000),
    };
    await db.insert(sessions).values(values);
    await expect(db.insert(sessions).values(values)).rejects.toThrow();
  });
});

describe("profiles", () => {
  it("L4詳細(detail)は既定で空。何も入れなければ何も持たない(憲法第二条)", async () => {
    const id = await newUser("profile_test");
    const [p] = await db
      .insert(profiles)
      .values({ userId: id, displayName: "さとし" })
      .returning();
    expect(p.detail).toEqual({});
    expect(p.bio).toBeNull();
  });
});

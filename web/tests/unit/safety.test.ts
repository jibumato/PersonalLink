import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { profiles, reports, users } from "@/db/schema";
import { establishConnection } from "@/lib/connection";
import {
  listMessages,
  loadChatContext,
  retractMessage,
  sendMessage,
  unreadCounts,
} from "@/lib/message";
import {
  blockUser,
  isBlockedByMe,
  listBlocked,
  submitReport,
  unblockUser,
} from "@/lib/safety";
import { exportAccount, deleteAccount } from "@/lib/account";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `sfy_user_${n++}` })
    .returning({ id: users.id });
  await db.insert(profiles).values({ userId: u.id, displayName: name });
  return u.id;
}

async function newChat() {
  const a = await newUser("Aさん");
  const b = await newUser("Bさん");
  const r = await establishConnection(a, b, 7);
  if (!r.ok) throw new Error("setup failed");
  return { a, b, id: r.connectionId };
}

beforeAll(async () => {
  db = await getDb();
});

describe("F-1: silent block", () => {
  it("ブロックしても、相手からは何も変わって見えない", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(b, id, "ブロック前", false);

    // 相手(b)から見た状態を控える
    const ctxBefore = await loadChatContext(b, id);
    const listBefore = await listMessages(b, id);

    await blockUser(a, b);

    const ctxAfter = await loadChatContext(b, id);
    const listAfter = await listMessages(b, id);

    // 相手の見え方は完全に同じ。ここが崩れると silent ではなくなる
    expect(ctxAfter).toEqual(ctxBefore);
    expect(listAfter).toEqual(listBefore);
  });

  it("ブロック中でも相手の送信は成功し、送信済みとして見える", async () => {
    const { a, b, id } = await newChat();
    await blockUser(a, b);

    const sent = await sendMessage(b, id, "届かないメッセージ", false);
    expect(sent.ok).toBe(true);

    // 送った本人の画面には普通に残る
    expect((await listMessages(b, id)).map((m) => m.body)).toContain("届かないメッセージ");
  });

  it("ブロックした側には届かない。未読にもならない", async () => {
    const { a, b, id } = await newChat();
    await blockUser(a, b);
    await sendMessage(b, id, "届かないメッセージ", false);

    expect((await listMessages(a, id)).map((m) => m.body)).not.toContain("届かないメッセージ");
    expect((await unreadCounts(a)).get(id) ?? 0).toBe(0);
  });

  it("ブロック前のメッセージは残る", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(b, id, "ブロック前のことば", false);
    await blockUser(a, b);

    expect((await listMessages(a, id)).map((m) => m.body)).toContain("ブロック前のことば");
  });

  it("ブロックしても、相手側のタイムラインに痕跡が残らない", async () => {
    const { a, b, id } = await newChat();
    const before = (await listMessages(b, id)).length;
    await blockUser(a, b);
    expect((await listMessages(b, id)).length).toBe(before);
  });

  it("解除しても、ブロック中のメッセージは配信されない", async () => {
    const { a, b, id } = await newChat();
    await blockUser(a, b);
    await sendMessage(b, id, "ブロック中に送った", false);
    await unblockUser(a, b);
    await sendMessage(b, id, "解除後に送った", false);

    const bodies = (await listMessages(a, id)).map((m) => m.body);
    expect(bodies).not.toContain("ブロック中に送った");
    expect(bodies).toContain("解除後に送った");
  });

  it("ブロック中は自分からも送らない", async () => {
    const { a, b, id } = await newChat();
    await blockUser(a, b);

    const ctx = await loadChatContext(a, id);
    expect(ctx!.blockedByMe).toBe(true);
    expect(ctx!.canSend).toBe(false);
    expect((await sendMessage(a, id, "送れないはず", false)).ok).toBe(false);
  });

  it("「相手にブロックされているか」を表すフィールドが存在しない", async () => {
    const { a, b, id } = await newChat();
    await blockUser(a, b);

    const ctx = (await loadChatContext(b, id))!;
    // ブロックに関する情報は blockedByMe(=自分の状態)しか無い。
    // 相手側の状態を載せる場所そのものが型に無いので、うっかり漏らせない
    const blockFields = Object.keys(ctx).filter((k) => /block/i.test(k));
    expect(blockFields).toEqual(["blockedByMe"]);
    expect(ctx.blockedByMe).toBe(false);
    // 相手にブロックされていても、送信は普通にできる(silent)
    expect(ctx.canSend).toBe(true);
  });

  it("二重にブロックしても壊れない", async () => {
    const { a, b } = await newChat();
    await blockUser(a, b);
    await blockUser(a, b);
    expect(await listBlocked(a)).toHaveLength(1);
  });

  it("自分はブロックできない", async () => {
    const a = await newUser("ひとり");
    expect((await blockUser(a, a)).ok).toBe(false);
  });

  it("ブロックリストに出て、解除で消える", async () => {
    const { a, b } = await newChat();
    await blockUser(a, b);
    expect((await listBlocked(a)).map((x) => x.userId)).toContain(b);
    expect(await isBlockedByMe(a, b)).toBe(true);

    await unblockUser(a, b);
    expect(await listBlocked(a)).toHaveLength(0);
    expect(await isBlockedByMe(a, b)).toBe(false);
  });
});

describe("F-1: 通報", () => {
  it("同意しなければ本文は保存されない(D-10)", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(b, id, "問題のある発言", false);

    await submitReport(a, {
      targetUserId: b,
      connectionId: id,
      category: "harassment",
      detail: "困っています",
      withMessages: false,
    });

    const [row] = await db.select().from(reports).where(eq(reports.reporterId, a));
    expect(row.withMessages).toBe(false);
    expect(row.evidence).toBeNull();
    expect(JSON.stringify(row)).not.toContain("問題のある発言");
  });

  it("同意したときだけ直近のメッセージが添えられる", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(b, id, "証跡に入る発言", false);

    await submitReport(a, {
      targetUserId: b,
      connectionId: id,
      category: "harassment",
      detail: null,
      withMessages: true,
    });

    const [row] = await db.select().from(reports).where(eq(reports.reporterId, a));
    expect(row.evidence!.some((e) => e.body === "証跡に入る発言")).toBe(true);
  });

  it("取り消したメッセージの本文は、同意しても証跡に入らない(D-12)", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(b, id, "取り消される発言", false);
    if (!sent.ok) throw new Error("send failed");
    await retractMessage(b, sent.message.id);

    await submitReport(a, {
      targetUserId: b,
      connectionId: id,
      category: "harassment",
      detail: null,
      withMessages: true,
    });

    const [row] = await db.select().from(reports).where(eq(reports.reporterId, a));
    expect(JSON.stringify(row.evidence)).not.toContain("取り消される発言");
    // 「あった」ことだけは残る
    expect(row.evidence!.some((e) => e.body === null)).toBe(true);
  });

  it("同意なしに証跡を付けることはDBが拒否する", async () => {
    const { a, b, id } = await newChat();
    await expect(
      db.insert(reports).values({
        reporterId: a,
        targetUserId: b,
        connectionId: id,
        category: "other",
        withMessages: false,
        evidence: [{ at: new Date().toISOString(), mine: false, body: "抜け道" }],
      }),
    ).rejects.toThrow();
  });

  it("自分は通報できない", async () => {
    const a = await newUser("ひとり");
    expect(
      (
        await submitReport(a, {
          targetUserId: a,
          connectionId: null,
          category: "other",
          detail: null,
          withMessages: false,
        })
      ).ok,
    ).toBe(false);
  });
});

describe("F-2: エクスポート(憲法第六条)", () => {
  it("自分の会話が入り、相手の情報は @ID と表示名にとどまる", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "自分の発言", false);
    await sendMessage(b, id, "相手の発言", false);

    const data = await exportAccount(a);
    const json = JSON.stringify(data);
    expect(json).toContain("自分の発言");
    expect(json).toContain("相手の発言");
    // 相手の内部IDは出さない
    expect(json).not.toContain(b);
  });

  it("相手の継続選択は含まれない(D-3)", async () => {
    const { a, b, id } = await newChat();
    const { chooseRenewal } = await import("@/lib/renewal");
    const { connections } = await import("@/db/schema");
    await db
      .update(connections)
      .set({
        expiresAt: new Date(Date.now() + 3600_000),
        graceUntil: new Date(Date.now() + 49 * 3600_000),
      })
      .where(eq(connections.id, id));

    await chooseRenewal(b, id, "end");
    await chooseRenewal(a, id, "continue");

    const data = await exportAccount(a);
    const mine = data.myRenewalChoices as { choice: string }[];
    // 自分のぶんだけ。相手の "end" は1件も入らない
    expect(mine).toHaveLength(1);
    expect(mine[0].choice).toBe("continue");
  });

  it("ブロックリストと端末も入る", async () => {
    const { a, b } = await newChat();
    await blockUser(a, b);
    const data = await exportAccount(a);
    expect((data.blocked as unknown[]).length).toBe(1);
    expect(data).toHaveProperty("devices");
  });
});

describe("F-2: アカウント削除(憲法第六条)", () => {
  it("自分のデータが消え、@IDは90日予約される", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "消える側の発言", false);
    const [{ handle }] = await db
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, a));

    await deleteAccount(a);

    // ユーザーが消えている
    expect(await db.select().from(users).where(eq(users.id, a))).toHaveLength(0);
    // プロフィール・参加も道連れ(ON DELETE CASCADE)
    expect(await db.select().from(profiles).where(eq(profiles.userId, a))).toHaveLength(0);

    // @ID はすぐには取れない(なりすまし防止)
    const { handleReservations } = await import("@/db/schema");
    const [res] = await db
      .select()
      .from(handleReservations)
      .where(eq(handleReservations.handle, handle));
    expect(res).toBeDefined();
    expect(res.reservedUntil.getTime()).toBeGreaterThan(Date.now());

    // 相手はまだ生きている
    expect(await db.select().from(users).where(eq(users.id, b))).toHaveLength(1);
  });

  it("添付の実体も一緒に消える", async () => {
    const { a, b, id } = await newChat();
    const { proposeLevel, acceptLevel } = await import("@/lib/level");
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment } = await import("@/lib/attachment");
    await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "x.png", data: Buffer.from([1, 2]) },
      false,
    );
    const { attachments } = await import("@/db/schema");
    const before = await db.select().from(attachments);

    await deleteAccount(a);

    const after = await db.select().from(attachments);
    expect(after.length).toBe(before.length - 1);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connections, groupMembers, messages, profiles, users } from "@/db/schema";
import { establishConnection } from "@/lib/connection";
import { retractMessage } from "@/lib/message";
import { acceptLevel, loadLevels, proposeLevel } from "@/lib/level";
import {
  createGroup,
  deleteGroup,
  groupUnreadCounts,
  invitableConnections,
  inviteToGroup,
  joinGroup,
  leaveGroup,
  listGroupMessages,
  listGroups,
  loadGroupContext,
  markGroupRead,
  removeMember,
  sendGroupMessage,
} from "@/lib/group";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `grp_user_${n++}` })
    .returning({ id: users.id });
  await db.insert(profiles).values({ userId: u.id, displayName: name });
  return u.id;
}

async function connect(a: string, b: string) {
  const r = await establishConnection(a, b, 7);
  if (!r.ok) throw new Error("connect failed");
  return r.connectionId;
}

/** つながっている3人と、そのうち2人を招いたグループ */
async function trio() {
  const a = await newUser("Aさん");
  const b = await newUser("Bさん");
  const c = await newUser("Cさん");
  await connect(a, b);
  await connect(a, c);
  return { a, b, c };
}

beforeAll(async () => {
  db = await getDb();
});

describe("G-1: 作成と招待", () => {
  it("つながっている相手だけを招待できる", async () => {
    const { a, b, c } = await trio();
    const list = await invitableConnections(a);
    expect(list.map((x) => x.userId).sort()).toEqual([b, c].sort());
  });

  it("つながっていない相手は招待できない", async () => {
    const { a } = await trio();
    const stranger = await newUser("知らない人");
    const r = await createGroup(a, "無理なグループ", [stranger]);
    expect(r.ok).toBe(false);
  });

  it("期限が切れた相手は招待できない(G-1)", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const id = await connect(a, b);
    await db
      .update(connections)
      .set({
        status: "expired",
        expiresAt: new Date(Date.now() - 100_000),
        graceUntil: new Date(Date.now() - 1000),
      })
      .where(eq(connections.id, id));

    expect(await invitableConnections(a)).toHaveLength(0);
    expect((await createGroup(a, "終わった関係", [b])).ok).toBe(false);
  });

  it("グループ名が空だと作れない", async () => {
    const { a, b } = await trio();
    expect((await createGroup(a, "   ", [b])).ok).toBe(false);
  });

  it("メンバーが0人だと作れない", async () => {
    const { a } = await trio();
    expect((await createGroup(a, "ひとりぼっち", [])).ok).toBe(false);
  });
});

describe("G-1: 勝手に入れない", () => {
  it("招待された人は参加するまでメンバーではない", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "展示めぐり", [b]);
    if (!g.ok) throw new Error("create failed");

    const ctx = await loadGroupContext(b, g.groupId);
    expect(ctx!.joined).toBe(false);
    // 会話も読めない
    expect(await listGroupMessages(b, g.groupId)).toHaveLength(0);
    // 書き込みもできない
    expect((await sendGroupMessage(b, g.groupId, "まだ入ってない", false)).ok).toBe(false);
  });

  it("参加すると、それまでの会話が読める", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "展示めぐり", [b]);
    if (!g.ok) throw new Error("create failed");
    await sendGroupMessage(a, g.groupId, "先に話しておきます", false);

    expect((await joinGroup(b, g.groupId)).ok).toBe(true);
    const list = await listGroupMessages(b, g.groupId);
    expect(list.map((m) => m.body)).toContain("先に話しておきます");
  });

  it("参加を断っても、他のメンバーには知らされない", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "展示めぐり", [b]);
    if (!g.ok) throw new Error("create failed");

    const before = await listGroupMessages(a, g.groupId);
    await leaveGroup(b, g.groupId);
    const after = await listGroupMessages(a, g.groupId);

    // タイムラインに1行も増えない
    expect(after).toHaveLength(before.length);
    expect(JSON.stringify(after)).not.toContain("Bさん");
  });

  it("参加した人が抜けたときは知らせる", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "展示めぐり", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);
    await leaveGroup(b, g.groupId);

    const texts = (await listGroupMessages(a, g.groupId)).map((m) => m.body);
    expect(texts.some((t) => t?.includes("退出しました"))).toBe(true);
  });

  it("参加していないグループは一覧に「招待」として出る", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "展示めぐり", [b]);
    if (!g.ok) throw new Error("create failed");

    const [row] = await listGroups(b);
    expect(row.pending).toBe(true);
    expect((await listGroups(a))[0].pending).toBe(false);
  });
});

describe("D-11: 1対1とは独立している", () => {
  it("グループで同席してもレベルは動かない", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const connectionId = await connect(a, b);

    const before = await loadLevels(a, connectionId);
    const g = await createGroup(a, "同席グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);
    await sendGroupMessage(b, g.groupId, "グループで話す", false);

    expect(await loadLevels(a, connectionId)).toEqual(before);
  });

  it("1対1が期限終了しても、グループ内では会話が続く", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const connectionId = await connect(a, b);
    const g = await createGroup(a, "続くグループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);

    // 1対1を終了させる
    await db
      .update(connections)
      .set({
        status: "expired",
        expiresAt: new Date(Date.now() - 100_000),
        graceUntil: new Date(Date.now() - 1000),
      })
      .where(eq(connections.id, connectionId));

    // グループは無関係に動く
    const sent = await sendGroupMessage(b, g.groupId, "1対1が切れても話せる", false);
    expect(sent.ok).toBe(true);
    expect((await listGroupMessages(a, g.groupId)).map((m) => m.body)).toContain(
      "1対1が切れても話せる",
    );
  });

  it("グループの写真はレベルに依存しない(D-11)", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const connectionId = await connect(a, b);
    const g = await createGroup(a, "写真グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);

    // 1対1では Lv.2 が無いので送れない
    const { sendAttachment, loadAttachment } = await import("@/lib/attachment");
    expect(
      (
        await sendAttachment(
          a,
          connectionId,
          { mime: "image/png", filename: "x.png", data: Buffer.from([1]) },
          false,
        )
      ).ok,
    ).toBe(false);

    // グループの添付は Lv.2 を見ない。直接入れて取り出せることを確かめる
    const { attachments } = await import("@/db/schema");
    const [row] = await db
      .insert(messages)
      .values({ groupId: g.groupId, senderId: a, kind: "image" })
      .returning();
    const [att] = await db
      .insert(attachments)
      .values({
        messageId: row.id,
        mime: "image/png",
        filename: "group.png",
        bytes: 1,
        data: Buffer.from([1]),
      })
      .returning({ id: attachments.id });

    void loadAttachment;
    void att;
    expect((await listGroupMessages(b, g.groupId)).some((m) => m.attachment)).toBe(true);
  });
});

describe("G-2: 会話", () => {
  async function joinedGroup() {
    const { a, b, c } = await trio();
    const g = await createGroup(a, "会話グループ", [b, c]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);
    await joinGroup(c, g.groupId);
    return { a, b, c, id: g.groupId };
  }

  it("相手の発言には送信者名が付き、自分の発言には付かない", async () => {
    const { a, b, id } = await joinedGroup();
    await sendGroupMessage(b, id, "こんにちは", false);

    const forA = (await listGroupMessages(a, id)).find((m) => m.body === "こんにちは")!;
    expect(forA.senderName).toBe("Bさん");
    const forB = (await listGroupMessages(b, id)).find((m) => m.body === "こんにちは")!;
    expect(forB.senderName).toBeUndefined();
    expect(forB.mine).toBe(true);
  });

  it("既読は表示されない(D-8)", async () => {
    const { a, b, id } = await joinedGroup();
    await sendGroupMessage(b, id, "読まれても変わらない", false);
    await markGroupRead(a, id);

    const forB = await listGroupMessages(b, id);
    expect(JSON.stringify(forB)).not.toContain("read");
    expect(JSON.stringify(forB)).not.toContain("既読");
  });

  it("ミュートは送信者にしか見えない(D-13)", async () => {
    const { a, b, id } = await joinedGroup();
    await sendGroupMessage(b, id, "静かに送る", false);
    await sendGroupMessage(b, id, "ミュートで送る", true);

    const forB = (await listGroupMessages(b, id)).find((m) => m.body === "ミュートで送る")!;
    expect(forB.muted).toBe(true);
    const forA = (await listGroupMessages(a, id)).find((m) => m.body === "ミュートで送る")!;
    expect(forA.muted).toBeUndefined();
  });

  it("取り消しは1対1と同じ実装で動く(D-12)", async () => {
    const { a, b, id } = await joinedGroup();
    const sent = await sendGroupMessage(b, id, "取り消される発言", false);
    if (!sent.ok) throw new Error("send failed");

    expect((await retractMessage(b, sent.message.id)).ok).toBe(true);

    // 全員の画面から本文が消える
    for (const u of [a, b]) {
      const list = await listGroupMessages(u, id);
      expect(list.map((m) => m.body)).not.toContain("取り消される発言");
      expect(list.find((m) => m.id === sent.message.id)!.retracted).toBe(true);
    }
    // DBにも本文が残っていない
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.message.id));
    expect(row.body).toBeNull();
  });

  it("未読バッジが立ち、開くと消える", async () => {
    const { a, b, id } = await joinedGroup();
    await sendGroupMessage(b, id, "未読になる", false);

    expect((await groupUnreadCounts(a)).get(id)).toBe(1);
    await markGroupRead(a, id);
    expect((await groupUnreadCounts(a)).get(id) ?? 0).toBe(0);
    // 送った本人は未読にならない
    expect((await groupUnreadCounts(b)).get(id) ?? 0).toBe(0);
  });

  it("参加していないグループは開けない", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "秘密のグループ", [b]);
    if (!g.ok) throw new Error("create failed");
    const stranger = await newUser("部外者");
    expect(await loadGroupContext(stranger, g.groupId)).toBeNull();
    expect(await listGroupMessages(stranger, g.groupId)).toHaveLength(0);
  });
});

describe("G-2: メンバー管理", () => {
  it("作成者だけがメンバーを外せる", async () => {
    const { a, b, c } = await trio();
    const g = await createGroup(a, "管理グループ", [b, c]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);
    await joinGroup(c, g.groupId);

    expect((await removeMember(b, g.groupId, c)).ok).toBe(false);
    expect((await removeMember(a, g.groupId, c)).ok).toBe(true);
    expect(await loadGroupContext(c, g.groupId)).toBeNull();
  });

  it("作成者だけがグループを消せる", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "消えるグループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);

    expect((await deleteGroup(b, g.groupId)).ok).toBe(false);
    expect((await deleteGroup(a, g.groupId)).ok).toBe(true);
    // 全員の一覧から消える
    expect(await listGroups(a)).toHaveLength(0);
    expect(await listGroups(b)).toHaveLength(0);
  });

  it("追加招待もつながっている相手だけ", async () => {
    const { a, b, c } = await trio();
    const g = await createGroup(a, "追加グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);

    const stranger = await newUser("知らない人");
    expect((await inviteToGroup(a, g.groupId, stranger)).ok).toBe(false);
    expect((await inviteToGroup(a, g.groupId, c)).ok).toBe(true);
    expect((await loadGroupContext(c, g.groupId))!.joined).toBe(false);
  });

  it("参加していない人は追加招待できない", async () => {
    const { a, b, c } = await trio();
    const g = await createGroup(a, "招待グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    // b はまだ参加していない
    expect((await inviteToGroup(b, g.groupId, c)).ok).toBe(false);
  });
});

describe("DB整合", () => {
  it("メッセージは1対1かグループのどちらか一方にしか属せない", async () => {
    const { a, b } = await trio();
    const connectionId = await connect(await newUser("Xさん"), await newUser("Yさん"));
    const g = await createGroup(a, "整合グループ", [b]);
    if (!g.ok) throw new Error("create failed");

    // 両方に属す
    await expect(
      db.insert(messages).values({ connectionId, groupId: g.groupId, senderId: a, body: "両方" }),
    ).rejects.toThrow();
    // どちらでもない
    await expect(
      db.insert(messages).values({ senderId: a, body: "どこにも属さない" }),
    ).rejects.toThrow();
  });

  it("グループを消すとメッセージも参加者も消える", async () => {
    const { a, b } = await trio();
    const g = await createGroup(a, "物理削除グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await sendGroupMessage(a, g.groupId, "消える発言", false);

    const { groups } = await import("@/db/schema");
    await db.delete(groups).where(eq(groups.id, g.groupId));

    expect(
      await db.select().from(messages).where(eq(messages.groupId, g.groupId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(groupMembers).where(eq(groupMembers.groupId, g.groupId)),
    ).toHaveLength(0);
  });

  it("1対1のレベル解放はグループに影響しない", async () => {
    const a = await newUser("Aさん");
    const b = await newUser("Bさん");
    const connectionId = await connect(a, b);
    const g = await createGroup(a, "無関係グループ", [b]);
    if (!g.ok) throw new Error("create failed");
    await joinGroup(b, g.groupId);

    const before = await listGroupMessages(a, g.groupId);
    await proposeLevel(a, connectionId, 2);
    await acceptLevel(b, connectionId, 2);

    // レベル解放のシステムメッセージはグループに流れない
    expect(await listGroupMessages(a, g.groupId)).toEqual(before);
  });
});

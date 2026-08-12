import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connectionMembers, connections, messages, profiles, users } from "@/db/schema";
import { establishConnection } from "@/lib/connection";
import {
  hideMessageForMe,
  listMessages,
  loadChatContext,
  markRead,
  pollMessages,
  postSystemMessage,
  retractMessage,
  sendMessage,
  unreadCounts,
} from "@/lib/message";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `msg_user_${n++}` })
    .returning({ id: users.id });
  await db.insert(profiles).values({ userId: u.id, displayName: name });
  return u.id;
}

/** 会話を1つ用意する */
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

describe("送受信", () => {
  it("送ると相手にも見える", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(a, id, "こんにちは", false);
    expect(sent.ok).toBe(true);

    const forB = await listMessages(b, id);
    const found = forB.find((m) => m.body === "こんにちは");
    expect(found).toBeDefined();
    expect(found!.mine).toBe(false);
  });

  it("成立時にシステムメッセージが入る(C-1 のタイムライン)", async () => {
    const { a, id } = await newChat();
    const list = await listMessages(a, id);
    expect(list[0].kind).toBe("system");
    expect(list[0].body).toContain("つながりました");
    // システムメッセージは誰のものでもない
    expect(list[0].mine).toBe(false);
  });

  it("空文字と長すぎる本文は拒否される", async () => {
    const { a, id } = await newChat();
    expect((await sendMessage(a, id, "   ", false)).ok).toBe(false);
    expect((await sendMessage(a, id, "あ".repeat(4001), false)).ok).toBe(false);
  });

  it("参加していない会話には送れない", async () => {
    const { id } = await newChat();
    const stranger = await newUser("部外者");
    const r = await sendMessage(stranger, id, "のぞき見", false);
    expect(r.ok).toBe(false);
    // 会話の存在自体を匂わせない
    if (!r.ok) expect(r.error).toContain("見つかりません");
    expect(await loadChatContext(stranger, id)).toBeNull();
  });
});

describe("D-8: 既読情報が存在しない", () => {
  it("返り値に既読を表すフィールドが無い", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "やあ", false);
    // b が読んでも、a 側の見え方は何も変わらない
    await markRead(b, id);

    const forA = await listMessages(a, id);
    const mine = forA.find((m) => m.body === "やあ")!;
    const keys = Object.keys(mine);
    for (const forbidden of ["read", "readAt", "seen", "seenAt", "readBy", "lastReadAt"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("相手の last_read_at はチャット情報に含まれない", async () => {
    const { a, b, id } = await newChat();
    await markRead(b, id);
    const ctx = await loadChatContext(a, id);
    expect(JSON.stringify(ctx)).not.toContain("astRead");
  });
});

describe("D-13: ミュート送信", () => {
  it("送信者には見えるが、受信者には露出しない", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "夜遅くにすみません", true);

    const forA = (await listMessages(a, id)).find((m) => m.body === "夜遅くにすみません")!;
    expect(forA.muted).toBe(true);

    const forB = (await listMessages(b, id)).find((m) => m.body === "夜遅くにすみません")!;
    // 「未定義」ではなく「キーが存在しない」ことを確かめる
    expect(Object.keys(forB)).not.toContain("muted");
    expect(JSON.stringify(forB)).not.toContain("muted");
  });

  it("ミュートでも本文はちゃんと届く(抑止するのは通知だけ)", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "届いてほしい", true);
    expect((await listMessages(b, id)).some((m) => m.body === "届いてほしい")).toBe(true);
  });

  it("システムメッセージはミュートになりえない(DB制約)", async () => {
    const { id } = await newChat();
    await expect(
      db.insert(messages).values({ connectionId: id, kind: "system", body: "x", muted: true }),
    ).rejects.toThrow();
  });
});

describe("D-12: 送信取り消し", () => {
  it("取り消すと本文がサーバーから消える(フラグ削除ではない)", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(a, id, "消したい内容", false);
    if (!sent.ok) throw new Error("setup failed");

    expect((await retractMessage(a, sent.message.id)).ok).toBe(true);

    // DBを直接見て、本文が残っていないことを確かめる
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.message.id));
    expect(row.body).toBeNull();
    expect(row.retractedAt).not.toBeNull();

    // 双方の画面ではトゥームストーンになる
    for (const who of [a, b]) {
      const m = (await listMessages(who, id)).find((x) => x.id === sent.message.id)!;
      expect(m.retracted).toBe(true);
      expect(m.body).toBeNull();
    }
  });

  it("本文を残したまま取り消し済みにはできない(DB制約が最後の砦)", async () => {
    const { a, id } = await newChat();
    const sent = await sendMessage(a, id, "残ってはいけない", false);
    if (!sent.ok) throw new Error("setup failed");
    // 実装がうっかり body を消し忘れたケース
    await expect(
      db
        .update(messages)
        .set({ retractedAt: new Date() })
        .where(eq(messages.id, sent.message.id)),
    ).rejects.toThrow();
  });

  it("他人のメッセージは取り消せない", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(a, id, "私の発言", false);
    if (!sent.ok) throw new Error("setup failed");
    const r = await retractMessage(b, sent.message.id);
    expect(r.ok).toBe(false);

    const [row] = await db.select().from(messages).where(eq(messages.id, sent.message.id));
    expect(row.body).toBe("私の発言");
  });

  it("24時間を過ぎると取り消せない", async () => {
    const { a, id } = await newChat();
    const sent = await sendMessage(a, id, "古い発言", false);
    if (!sent.ok) throw new Error("setup failed");
    await db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(messages.id, sent.message.id));

    const r = await retractMessage(a, sent.message.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("24時間");
  });

  it("終了した接続では取り消せない(凍結状態を変えない)", async () => {
    const { a, id } = await newChat();
    const sent = await sendMessage(a, id, "終了後", false);
    if (!sent.ok) throw new Error("setup failed");
    await db
      .update(connections)
      .set({ status: "expired", expiresAt: new Date() })
      .where(eq(connections.id, id));

    const r = await retractMessage(a, sent.message.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("終了した接続");
  });

  it("取り消しは相手のポーリングにも差分として届く", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(a, id, "あとで消す", false);
    if (!sent.ok) throw new Error("setup failed");

    // b が一度読み終えた時点をカーソルにする
    const first = await pollMessages(b, id);
    expect(first.messages.some((m) => m.id === sent.message.id)).toBe(true);

    await retractMessage(a, sent.message.id);

    // 作成時刻は変わっていないが、取り消しは差分に含まれる
    const diff = await pollMessages(b, id, new Date(first.now));
    const found = diff.messages.find((m) => m.id === sent.message.id);
    expect(found, "取り消しが相手に伝わらないと D-12 が実質壊れる").toBeDefined();
    expect(found!.retracted).toBe(true);
  });
});

describe("自分の画面から削除", () => {
  it("自分には見えなくなるが、相手には残る", async () => {
    const { a, b, id } = await newChat();
    const sent = await sendMessage(a, id, "自分だけ消す", false);
    if (!sent.ok) throw new Error("setup failed");

    await hideMessageForMe(a, sent.message.id);

    expect((await listMessages(a, id)).some((m) => m.id === sent.message.id)).toBe(false);
    const forB = (await listMessages(b, id)).find((m) => m.id === sent.message.id);
    expect(forB).toBeDefined();
    expect(forB!.body).toBe("自分だけ消す");
  });

  it("二重に消しても壊れない", async () => {
    const { a, id } = await newChat();
    const sent = await sendMessage(a, id, "二回消す", false);
    if (!sent.ok) throw new Error("setup failed");
    await hideMessageForMe(a, sent.message.id);
    await hideMessageForMe(a, sent.message.id);
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.message.id));
    expect(row.deletedBy).toEqual([a]);
  });
});

describe("送信可否(不変条件1)", () => {
  it("grace では送れないが読める(D-4)", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "期限前の発言", false);
    await db
      .update(connections)
      .set({ status: "grace", expiresAt: new Date(Date.now() - 1000) })
      .where(eq(connections.id, id));

    const ctx = await loadChatContext(a, id);
    expect(ctx!.canSend).toBe(false);
    const r = await sendMessage(a, id, "送れないはず", false);
    expect(r.ok).toBe(false);
    // 閲覧はできる
    expect((await listMessages(b, id)).some((m) => m.body === "期限前の発言")).toBe(true);
  });

  it("恒久(permanent)では送れる", async () => {
    const { a, id } = await newChat();
    await db
      .update(connections)
      .set({ status: "permanent", expiresAt: null })
      .where(eq(connections.id, id));
    const ctx = await loadChatContext(a, id);
    expect(ctx!.canSend).toBe(true);
    expect((await sendMessage(a, id, "ずっとよろしく", false)).ok).toBe(true);
  });
});

describe("未読バッジ", () => {
  it("相手のメッセージだけを数える", async () => {
    const { a, b, id } = await newChat();
    await markRead(a, id); // 成立時のシステムメッセージを読み終えた状態にする
    await sendMessage(b, id, "1", false);
    await sendMessage(b, id, "2", false);
    await sendMessage(a, id, "自分の発言", false);

    expect((await unreadCounts(a)).get(id)).toBe(2);
    // 開けば 0 になる
    await markRead(a, id);
    expect((await unreadCounts(a)).get(id) ?? 0).toBe(0);
  });

  it("取り消されたメッセージは未読に数えない", async () => {
    const { a, b, id } = await newChat();
    await markRead(a, id);
    const sent = await sendMessage(b, id, "取り消す予定", false);
    if (!sent.ok) throw new Error("setup failed");
    expect((await unreadCounts(a)).get(id)).toBe(1);

    await retractMessage(b, sent.message.id);
    expect((await unreadCounts(a)).get(id) ?? 0).toBe(0);
  });
});

describe("DB制約: messages", () => {
  it("システムメッセージに送信者は付けられない", async () => {
    const { a, id } = await newChat();
    await expect(
      db.insert(messages).values({ connectionId: id, senderId: a, kind: "system", body: "x" }),
    ).rejects.toThrow();
  });

  it("通常メッセージに送信者は必須", async () => {
    const { id } = await newChat();
    await expect(
      db.insert(messages).values({ connectionId: id, senderId: null, kind: "text", body: "x" }),
    ).rejects.toThrow();
  });

  it("Connectionを消すとメッセージも消える(憲法第六条)", async () => {
    const { a, id } = await newChat();
    await sendMessage(a, id, "消える", false);
    await db.delete(connections).where(eq(connections.id, id));
    expect(await db.select().from(messages).where(eq(messages.connectionId, id))).toHaveLength(0);
  });

  it("messages に既読を表すカラムが存在しない(D-8をスキーマで担保)", async () => {
    const cols = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'messages'`,
    );
    const rows = (cols as unknown as { rows?: { column_name: string }[] }).rows ??
      (cols as unknown as { column_name: string }[]);
    const names = Array.isArray(rows) ? rows.map((r) => r.column_name) : [];
    for (const forbidden of ["read_at", "read_by", "seen_at", "delivered_at"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});

describe("postSystemMessage", () => {
  it("誰のものでもないメッセージとして入る", async () => {
    const { a, id } = await newChat();
    await postSystemMessage(id, "♾ 恒久になりました");
    const list = await listMessages(a, id);
    const sys = list.find((m) => m.body === "♾ 恒久になりました")!;
    expect(sys.kind).toBe("system");
    expect(sys.mine).toBe(false);
    expect(Object.keys(sys)).not.toContain("muted");
  });
});

describe("参加者の整合", () => {
  it("hidden にした本人はチャットを開けない(履歴削除の意味を保つ)", async () => {
    const { a, id } = await newChat();
    await db
      .update(connectionMembers)
      .set({ hiddenAt: new Date() })
      .where(and(eq(connectionMembers.connectionId, id), eq(connectionMembers.userId, a)));
    expect(await loadChatContext(a, id)).toBeNull();
  });
});

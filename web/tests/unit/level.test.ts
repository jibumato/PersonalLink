import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connections, levelGrants, levelProposals, profiles, users } from "@/db/schema";
import { establishConnection } from "@/lib/connection";
import { listMessages, sendMessage } from "@/lib/message";
import {
  acceptLevel,
  dismissProposal,
  hasLevel,
  loadLevels,
  pendingProposalFor,
  proposeLevel,
  proposePermanent,
  revokeLevel,
} from "@/lib/level";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `lvl_user_${n++}` })
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

/** 提案時刻を過去へずらす(72時間ルールの検証用) */
async function agePropose(connectionId: string, hours: number) {
  await db
    .update(levelProposals)
    .set({ proposedAt: new Date(Date.now() - hours * 3600_000) })
    .where(eq(levelProposals.connectionId, connectionId));
}

const view = async (userId: string, id: string, level: number) =>
  (await loadLevels(userId, id))!.find((l) => l.level === level)!;

beforeAll(async () => {
  db = await getDb();
});

describe("レベルの初期状態", () => {
  it("成立直後は Lv.1 だけが解放されている", async () => {
    const { a, id } = await newChat();
    const levels = (await loadLevels(a, id))!;
    expect(levels.map((l) => l.granted)).toEqual([true, false, false, false]);
  });

  it("Lv.3 は準備中で、提案できない(D-6)", async () => {
    const { a, id } = await newChat();
    expect((await view(a, id, 3)).comingSoon).toBe(true);
    expect((await proposeLevel(a, id, 3)).ok).toBe(false);
  });

  it("Lv.3 はDB制約でも入れられない(準備中のものが解放されない)", async () => {
    const { id } = await newChat();
    // CHECK制約 level_grants_level が拒否する
    await expect(
      db.insert(levelGrants).values({ connectionId: id, level: 3 }),
    ).rejects.toThrow();
  });

  it("参加していない人からは見えない", async () => {
    const { id } = await newChat();
    const stranger = await newUser("部外者");
    expect(await loadLevels(stranger, id)).toBeNull();
  });
});

describe("D-5: 解放は双方合意", () => {
  it("提案しただけでは解放されない", async () => {
    const { a, b, id } = await newChat();
    expect((await proposeLevel(a, id, 2)).ok).toBe(true);

    expect(await hasLevel(id, 2)).toBe(false);
    expect((await view(a, id, 2)).proposedByMe).toBe(true);
    expect((await view(b, id, 2)).awaitingMyAnswer).toBe(true);
  });

  it("自分の提案は自分では承諾できない", async () => {
    const { a, id } = await newChat();
    await proposeLevel(a, id, 2);
    expect((await acceptLevel(a, id, 2)).ok).toBe(false);
    expect(await hasLevel(id, 2)).toBe(false);
  });

  it("相手が承諾すると即時に発効し、タイムラインに残る", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    expect((await acceptLevel(b, id, 2)).ok).toBe(true);

    expect(await hasLevel(id, 2)).toBe(true);
    const texts = (await listMessages(a, id)).map((m) => m.body);
    expect(texts.some((t) => t?.includes("写真・ファイルが解放されました"))).toBe(true);
  });

  it("二重に解放されない(生きた解放は1つ)", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await expect(
      db.insert(levelGrants).values({ connectionId: id, level: 2 }),
    ).rejects.toThrow();
  });
});

describe("D-5: 拒否は相手に伝わらない", () => {
  it("「今はしない」で自分のカードは消えるが、相手の見え方は変わらない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);

    const before = await view(a, id, 2);
    expect(await pendingProposalFor(b, id)).not.toBeNull();

    await dismissProposal(b, id, 2);

    // 受け手のチャットからカードは消える
    expect(await pendingProposalFor(b, id)).toBeNull();
    // 提案者の見え方は1つも変わらない
    expect(await view(a, id, 2)).toEqual(before);
  });

  it("閉じても提案は生きていて、あとから承諾できる(E-1から)", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await dismissProposal(b, id, 2);

    expect((await view(b, id, 2)).awaitingMyAnswer).toBe(true);
    expect((await acceptLevel(b, id, 2)).ok).toBe(true);
    expect(await hasLevel(id, 2)).toBe(true);
  });

  it("拒否を記録するカラムが存在しない", async () => {
    const cols = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'level_proposals'`,
    );
    // ドライバによって配列そのもの / { rows } を返すので、両方を受ける
    const raw = cols as unknown as
      | { column_name: string }[]
      | { rows: { column_name: string }[] };
    const names = (Array.isArray(raw) ? raw : raw.rows).map((r) => r.column_name);
    expect(names).toContain("proposed_by");
    expect(names).not.toContain("rejected_at");
    expect(names).not.toContain("declined_at");
  });
});

describe("C-2: 再提案は72時間に1回", () => {
  it("直後の再提案は断られる", async () => {
    const { a, id } = await newChat();
    await proposeLevel(a, id, 2);
    const again = await proposeLevel(a, id, 2);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("72");
  });

  it("72時間たてば再提案できる", async () => {
    const { a, id } = await newChat();
    await proposeLevel(a, id, 2);
    await agePropose(id, 73);
    expect((await proposeLevel(a, id, 2)).ok).toBe(true);
  });

  it("相手からの提案は自分の72時間に影響しない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    // b はまだ一度も提案していないので出せる
    expect((await proposeLevel(b, id, 2)).ok).toBe(true);
  });
});

describe("D-5: 停止は一方的・即時", () => {
  it("相手の同意なしに、その場で停止できる", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    // 提案した側からでも停止できる
    expect((await revokeLevel(a, id, 2)).ok).toBe(true);
    expect(await hasLevel(id, 2)).toBe(false);
  });

  it("停止は記録に残るが、誰が停めたかは書かない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await revokeLevel(a, id, 2);

    const sys = (await listMessages(b, id)).filter((m) => m.kind === "system");
    const last = sys.at(-1)!.body!;
    expect(last).toContain("停止");
    // 相手の名前もハンドルも出さない(咎める空気を作らない)
    expect(last).not.toContain("Aさん");
    expect(last).not.toContain("@");
  });

  it("停止後は再提案できる", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await revokeLevel(b, id, 2);
    // 72時間ルールは提案時刻で見るので、過去へずらす
    await agePropose(id, 73);
    expect((await proposeLevel(a, id, 2)).ok).toBe(true);
  });

  it("停止した記録は誰が停めたかをDBに持つ(運用調査用。UIには出さない)", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await revokeLevel(b, id, 2);

    const [row] = await db
      .select()
      .from(levelGrants)
      .where(and(eq(levelGrants.connectionId, id), eq(levelGrants.level, 2)));
    expect(row.revokedBy).toBe(b);
  });
});

describe("終了した接続では動かせない", () => {
  it("expired では提案も承諾もできない", async () => {
    const { a, b, id } = await newChat();
    await db
      .update(connections)
      .set({ status: "expired", expiresAt: new Date(Date.now() - 1000) })
      .where(eq(connections.id, id));

    expect((await proposeLevel(a, id, 2)).ok).toBe(false);
    expect((await acceptLevel(b, id, 2)).ok).toBe(false);
  });
});

describe("E-1: 恒久化の提案", () => {
  it("期限が遠くても提案でき、双方そろえば恒久になる", async () => {
    const { a, b, id } = await newChat();
    // 期限まで7日ある = 継続確認の期間外
    const first = await proposePermanent(a, id);
    expect(first.ok).toBe(true);
    expect(first.becamePermanent).toBe(false);

    const second = await proposePermanent(b, id);
    expect(second.becamePermanent).toBe(true);

    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.status).toBe("permanent");
    expect(row.expiresAt).toBeNull();
  });
});

describe("不変条件2: 添付は Lv.2 が要る", () => {
  it("Lv.2 が無いと送れない", async () => {
    const { a, id } = await newChat();
    const { sendAttachment } = await import("@/lib/attachment");
    const r = await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "x.png", data: Buffer.from([1, 2, 3]) },
      false,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Lv.2");
  });

  it("Lv.2 を解放すると送れる", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment } = await import("@/lib/attachment");
    const r = await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "photo.png", data: Buffer.from([1, 2, 3, 4]) },
      false,
    );
    expect(r.ok).toBe(true);
  });

  it("停止すると、また送れなくなる", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await revokeLevel(b, id, 2);

    const { sendAttachment } = await import("@/lib/attachment");
    const r = await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "x.png", data: Buffer.from([1]) },
      false,
    );
    expect(r.ok).toBe(false);
  });

  it("許可していない形式は送れない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment } = await import("@/lib/attachment");
    const r = await sendAttachment(
      a,
      id,
      { mime: "application/x-msdownload", filename: "x.exe", data: Buffer.from([1]) },
      false,
    );
    expect(r.ok).toBe(false);
  });

  it("大きすぎるファイルは送れない(DBのCHECKにも同じ上限)", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { MAX_ATTACHMENT_BYTES } = await import("@/db/schema");
    const { sendAttachment } = await import("@/lib/attachment");
    const r = await sendAttachment(
      a,
      id,
      {
        mime: "image/png",
        filename: "big.png",
        data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
      },
      false,
    );
    expect(r.ok).toBe(false);
  });
});

describe("D-12: 取り消すと添付の実体も消える", () => {
  it("取り消した添付は相手からも自分からも取れない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment, loadAttachment } = await import("@/lib/attachment");
    const sent = await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "secret.png", data: Buffer.from([9, 9, 9]) },
      false,
    );
    if (!sent.ok) throw new Error("send failed");

    const list = await listMessages(b, id);
    const withAttachment = list.find((m) => m.attachment)!;
    const attachmentId = withAttachment.attachment!.id;
    expect(await loadAttachment(b, attachmentId)).not.toBeNull();

    const { retractMessage } = await import("@/lib/message");
    expect((await retractMessage(a, withAttachment.id)).ok).toBe(true);

    expect(await loadAttachment(b, attachmentId)).toBeNull();
    expect(await loadAttachment(a, attachmentId)).toBeNull();

    // 実体そのものが行ごと消えている
    const { attachments } = await import("@/db/schema");
    expect(
      await db.select().from(attachments).where(eq(attachments.id, attachmentId)),
    ).toHaveLength(0);
  });

  it("共有を停止すると、すでに送った添付も見えなくなる(T-6)", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment, loadAttachment } = await import("@/lib/attachment");
    await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "past.png", data: Buffer.from([7]) },
      false,
    );
    const attachmentId = (await listMessages(b, id)).find((m) => m.attachment)!.attachment!.id;
    expect(await loadAttachment(b, attachmentId)).not.toBeNull();

    await revokeLevel(b, id, 2);

    // 実体は残っているが、渡さない。ファイル名も出さない
    expect(await loadAttachment(b, attachmentId)).toBeNull();
    expect(await loadAttachment(a, attachmentId)).toBeNull();
    const view = (await listMessages(b, id)).find((m) => m.locked);
    expect(view).toBeDefined();
    expect(JSON.stringify(view)).not.toContain("past.png");

    // 再解放すれば、また見える(消してはいない)
    await agePropose(id, 73);
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    expect(await loadAttachment(b, attachmentId)).not.toBeNull();
  });

  it("参加していない人は添付を取れない", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);

    const { sendAttachment, loadAttachment } = await import("@/lib/attachment");
    await sendAttachment(
      a,
      id,
      { mime: "image/png", filename: "x.png", data: Buffer.from([1]) },
      false,
    );
    const attachmentId = (await listMessages(a, id)).find((m) => m.attachment)!.attachment!.id;

    const stranger = await newUser("部外者");
    expect(await loadAttachment(stranger, attachmentId)).toBeNull();
  });
});

describe("システムメッセージの重複", () => {
  it("承諾を2回呼んでも解放メッセージは1回だけ", async () => {
    const { a, b, id } = await newChat();
    await proposeLevel(a, id, 2);
    await acceptLevel(b, id, 2);
    await acceptLevel(b, id, 2);

    const sys = (await listMessages(a, id)).filter(
      (m) => m.kind === "system" && m.body?.includes("解放されました"),
    );
    expect(sys).toHaveLength(1);
  });

  it("送信は Lv.2 と無関係に通る(不変条件1はレベルではなく期限で決まる)", async () => {
    const { a, id } = await newChat();
    expect((await sendMessage(a, id, "レベル0でも文字は送れる", false)).ok).toBe(true);
  });
});

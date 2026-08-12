import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { getDb, type Database } from "@/db";
import { connections, messages, profiles, renewalChoices, users } from "@/db/schema";
import { establishConnection, listConnections } from "@/lib/connection";
import {
  deleteHistoryForMe,
  listMessages,
  loadChatContext,
  sendMessage,
} from "@/lib/message";
import {
  advanceExpiries,
  canChooseRenewal,
  chooseRenewal,
  deriveStatus,
  isExpiring,
  loadMyRenewal,
  reconcileStatus,
} from "@/lib/renewal";

let db: Database;
let n = 0;

async function newUser(name: string) {
  const [u] = await db
    .insert(users)
    .values({ handle: `rnw_user_${n++}` })
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

/**
 * 時計を進める代わりに、期限を過去へずらす。
 *
 * 恒久化済みは期限を持てない(不変条件3)ので触らない。
 * ここを無条件にすると DB の CHECK 制約に弾かれる — 制約が効いている証拠でもある。
 */
async function shiftDeadline(id: string, opts: { expiresInH: number; graceInH: number }) {
  await db
    .update(connections)
    .set({
      expiresAt: new Date(Date.now() + opts.expiresInH * 3600_000),
      graceUntil: new Date(Date.now() + opts.graceInH * 3600_000),
    })
    .where(and(eq(connections.id, id), ne(connections.status, "permanent")));
}

const H = 3600_000;

beforeAll(async () => {
  db = await getDb();
});

describe("deriveStatus(状態の唯一の正)", () => {
  const t0 = Date.UTC(2026, 0, 10, 0, 0, 0);
  const at = (h: number) => new Date(t0 + h * H);

  it("期限前は active", () => {
    expect(
      deriveStatus({ status: "active", expiresAt: at(5), graceUntil: at(53) }, t0),
    ).toBe("active");
  });

  it("期限を過ぎ猶予内なら grace", () => {
    expect(
      deriveStatus({ status: "active", expiresAt: at(-1), graceUntil: at(47) }, t0),
    ).toBe("grace");
  });

  it("猶予も過ぎたら expired", () => {
    expect(
      deriveStatus({ status: "active", expiresAt: at(-49), graceUntil: at(-1) }, t0),
    ).toBe("expired");
  });

  it("恒久は時刻に関係なく permanent", () => {
    expect(
      deriveStatus({ status: "permanent", expiresAt: null, graceUntil: null }, t0),
    ).toBe("permanent");
  });

  it("保存された status が古くても、導出が優先される(Cron遅延に強い)", () => {
    // DBには active と書かれているが、実際は猶予も過ぎている
    expect(
      deriveStatus({ status: "active", expiresAt: at(-100), graceUntil: at(-52) }, t0),
    ).toBe("expired");
  });
});

describe("isExpiring / canChooseRenewal", () => {
  const t0 = Date.now();
  const at = (h: number) => new Date(t0 + h * H);

  it("残り24時間を切ると期限接近(D-1)", () => {
    expect(isExpiring({ status: "active", expiresAt: at(25), graceUntil: at(73) }, t0)).toBe(false);
    expect(isExpiring({ status: "active", expiresAt: at(23), graceUntil: at(71) }, t0)).toBe(true);
  });

  it("恒久は期限接近にならない", () => {
    expect(isExpiring({ status: "permanent", expiresAt: null, graceUntil: null }, t0)).toBe(false);
  });

  it("継続確認は期限24h前から猶予終了まで受け付ける", () => {
    const before = { status: "active" as const, expiresAt: at(48), graceUntil: at(96) };
    const near = { status: "active" as const, expiresAt: at(3), graceUntil: at(51) };
    const grace = { status: "grace" as const, expiresAt: at(-1), graceUntil: at(47) };
    const done = { status: "expired" as const, expiresAt: at(-50), graceUntil: at(-2) };
    expect(canChooseRenewal(before, t0)).toBe(false);
    expect(canChooseRenewal(near, t0)).toBe(true);
    expect(canChooseRenewal(grace, t0)).toBe(true);
    expect(canChooseRenewal(done, t0)).toBe(false);
  });
});

describe("評価マトリクス(仕様書 §3)", () => {
  /** 2人の選択を与えて、猶予終了後の最終状態を得る */
  async function play(
    aChoice: "continue" | "end" | null,
    bChoice: "continue" | "end" | null,
  ) {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 }); // 期限接近
    if (aChoice) await chooseRenewal(a, id, aChoice);
    if (bChoice) await chooseRenewal(b, id, bChoice);

    const mid = deriveStatus(
      (await db.select().from(connections).where(eq(connections.id, id)))[0],
    );

    // 猶予終了まで進める
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await advanceExpiries();
    const [after] = await db.select().from(connections).where(eq(connections.id, id));
    return { id, mid, final: deriveStatus(after) };
  }

  it("継続 × 継続 → そろった瞬間に恒久化", async () => {
    const { mid, final } = await play("continue", "continue");
    expect(mid).toBe("permanent");
    // 恒久になったあとは期限処理の対象外
    expect(final).toBe("permanent");
  });

  it("継続 × 継続しない → 猶予終了で終了", async () => {
    const { mid, final } = await play("continue", "end");
    expect(mid).not.toBe("permanent");
    expect(final).toBe("expired");
  });

  it("継続 × 未選択 → 猶予終了で終了", async () => {
    expect((await play("continue", null)).final).toBe("expired");
  });

  it("継続しない × 継続しない → 猶予終了で終了", async () => {
    expect((await play("end", "end")).final).toBe("expired");
  });

  it("継続しない × 未選択 → 猶予終了で終了", async () => {
    expect((await play("end", null)).final).toBe("expired");
  });

  it("未選択 × 未選択 → 猶予終了で終了", async () => {
    expect((await play(null, null)).final).toBe("expired");
  });
});

describe("D-16: 終了タイミングは選択によらず同じ", () => {
  /**
   * ここが崩れると、猶予の有無から相手の選択が推測できてしまう。
   * 「通知しない」だけでは D-3 を守れない。
   */
  async function statusAtGrace(
    aChoice: "continue" | "end" | null,
    bChoice: "continue" | "end" | null,
  ) {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    if (aChoice) await chooseRenewal(a, id, aChoice);
    if (bChoice) await chooseRenewal(b, id, bChoice);

    // 期限は過ぎたが猶予中
    await shiftDeadline(id, { expiresInH: -1, graceInH: 47 });
    await advanceExpiries();
    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    return deriveStatus(row);
  }

  it("「継続しない」を選んでも、期限直後は他と同じく grace になる", async () => {
    const withEnd = await statusAtGrace("end", null);
    const withNothing = await statusAtGrace(null, null);
    const withContinue = await statusAtGrace("continue", null);
    // 3つとも同じ。ここに差があると選択が漏れる
    expect(withEnd).toBe("grace");
    expect(withNothing).toBe("grace");
    expect(withContinue).toBe("grace");
  });

  it("終了時のシステムメッセージは選択によらず同じ文言", async () => {
    const texts: string[] = [];
    for (const choice of ["end", "continue", null] as const) {
      const { a, id } = await newChat();
      await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
      if (choice) await chooseRenewal(a, id, choice);
      await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
      await advanceExpiries();
      const list = await listMessages(a, id);
      texts.push(list.at(-1)!.body!);
    }
    expect(new Set(texts).size, "終了の文言が選択によって違うと拒否が漏れる").toBe(1);
    expect(texts[0]).toBe("この接続は期限を迎えました");
  });
});

describe("D-3: 相手の選択が漏れない", () => {
  it("継続確認の返り値に相手の選択が含まれない", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(b, id, "end");

    const mine = await loadMyRenewal(a, id);
    expect(mine!.myChoice).toBeNull();
    // 相手が end を選んでいても、その痕跡がどこにも出ない
    expect(JSON.stringify(mine)).not.toContain("end");
  });

  it("自分の選択は自分にだけ返る", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "end");

    expect((await loadMyRenewal(a, id))!.myChoice).toBe("end");
    expect((await loadMyRenewal(b, id))!.myChoice).toBeNull();
  });

  it("相手が「継続しない」を選んでも、チャット画面に変化が出ない", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });

    const before = await loadChatContext(a, id);
    await chooseRenewal(b, id, "end");
    const after = await loadChatContext(a, id);
    expect(after).toEqual(before);
  });
});

describe("恒久化", () => {
  it("双方継続で即座に恒久化し、システムメッセージが入る", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "continue");
    const r = await chooseRenewal(b, id, "continue");
    expect(r.ok && r.becamePermanent).toBe(true);

    const ctx = await loadChatContext(a, id);
    expect(ctx!.status).toBe("permanent");
    expect(ctx!.expiresAt).toBeNull();
    expect(ctx!.canSend).toBe(true);

    const list = await listMessages(a, id);
    expect(list.at(-1)!.body).toContain("恒久");
  });

  it("恒久化は1回だけ祝う(何度呼んでもメッセージが増えない)", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "continue");
    await chooseRenewal(b, id, "continue");
    await chooseRenewal(b, id, "continue");

    const list = await listMessages(a, id);
    expect(list.filter((m) => m.body?.includes("恒久"))).toHaveLength(1);
  });

  it("猶予中でも双方継続なら復活して恒久化する(D-4)", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: -1, graceInH: 47 });
    await advanceExpiries();
    expect((await loadChatContext(a, id))!.status).toBe("grace");

    await chooseRenewal(a, id, "continue");
    const r = await chooseRenewal(b, id, "continue");
    expect(r.ok && r.becamePermanent).toBe(true);

    const ctx = await loadChatContext(a, id);
    expect(ctx!.status).toBe("permanent");
    // 復活したので、また送れる
    expect(ctx!.canSend).toBe(true);
    expect((await sendMessage(a, id, "また話せますね", false)).ok).toBe(true);
  });

  it("片方が「継続しない」から「継続」に変えれば恒久化できる", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "end");
    await chooseRenewal(b, id, "continue");
    expect((await loadChatContext(a, id))!.status).not.toBe("permanent");

    const r = await chooseRenewal(a, id, "continue");
    expect(r.ok && r.becamePermanent).toBe(true);
  });
});

describe("送信可否の遷移(D-4)", () => {
  it("期限を過ぎると送れなくなるが、閲覧はできる", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "期限前の発言", false);
    await shiftDeadline(id, { expiresInH: -1, graceInH: 47 });
    await advanceExpiries();

    expect((await sendMessage(a, id, "送れないはず", false)).ok).toBe(false);
    expect((await listMessages(b, id)).some((m) => m.body === "期限前の発言")).toBe(true);
  });

  it("猶予も過ぎると expired。閲覧のみになる", async () => {
    const { a, id } = await newChat();
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await advanceExpiries();
    const ctx = await loadChatContext(a, id);
    expect(ctx!.status).toBe("expired");
    expect(ctx!.canSend).toBe(false);
  });
});

describe("継続確認を受け付ける期間", () => {
  it("期限までまだ遠いと選べない", async () => {
    const { a, id } = await newChat();
    const r = await chooseRenewal(a, id, "continue");
    expect(r.ok).toBe(false);
  });

  it("終了後は選べない", async () => {
    const { a, id } = await newChat();
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await advanceExpiries();
    const r = await chooseRenewal(a, id, "continue");
    expect(r.ok).toBe(false);
  });

  it("参加していない人は選べない", async () => {
    const { id } = await newChat();
    const stranger = await newUser("部外者");
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    const r = await chooseRenewal(stranger, id, "continue");
    expect(r.ok).toBe(false);
    expect(await loadMyRenewal(stranger, id)).toBeNull();
  });
});

describe("遅延評価(T-8)", () => {
  it("Cronが動いていなくても、開いた時点で正しい状態になる", async () => {
    const { id } = await newChat();
    // ジョブを回さずに期限だけ過ぎさせる
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    const [stale] = await db.select().from(connections).where(eq(connections.id, id));
    expect(stale.status).toBe("active"); // DBは古いまま

    // 画面を開いた相当
    expect(await reconcileStatus(id)).toBe("expired");
    const [fresh] = await db.select().from(connections).where(eq(connections.id, id));
    expect(fresh.status).toBe("expired");
    expect(fresh.endedAt).not.toBeNull();
  });

  it("遅延評価とジョブで終了メッセージが二重に入らない", async () => {
    const { a, id } = await newChat();
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await reconcileStatus(id);
    await advanceExpiries();
    await reconcileStatus(id);

    const list = await listMessages(a, id);
    expect(list.filter((m) => m.body === "この接続は期限を迎えました")).toHaveLength(1);
  });
});

describe("DB整合", () => {
  it("恒久化すると期限も猶予も外れる(不変条件3)", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "continue");
    await chooseRenewal(b, id, "continue");

    const [row] = await db.select().from(connections).where(eq(connections.id, id));
    expect(row.status).toBe("permanent");
    expect(row.expiresAt).toBeNull();
    expect(row.graceUntil).toBeNull();
  });

  it("Connectionを消すと選択も消える", async () => {
    const { a, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });
    await chooseRenewal(a, id, "continue");
    await db.delete(connections).where(eq(connections.id, id));
    expect(
      await db.select().from(renewalChoices).where(eq(renewalChoices.connectionId, id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(messages).where(eq(messages.connectionId, id)),
    ).toHaveLength(0);
  });
});

describe("D-3 終了状態の履歴削除(憲法第六条)", () => {
  it("生きている接続では消せない", async () => {
    const { a, id } = await newChat();
    const r = await deleteHistoryForMe(a, id);
    expect(r.ok).toBe(false);
  });

  it("終了後は自分側だけ消え、相手の履歴は残る", async () => {
    const { a, b, id } = await newChat();
    await sendMessage(a, id, "残る側", false);
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await advanceExpiries();

    expect((await deleteHistoryForMe(a, id)).ok).toBe(true);

    // 自分からは会話ごと見えなくなる
    expect(await loadChatContext(a, id)).toBeNull();
    expect((await listConnections(a)).map((c) => c.id)).not.toContain(id);

    // 相手の側は無傷
    expect(await loadChatContext(b, id)).not.toBeNull();
    expect((await listMessages(b, id)).map((m) => m.body)).toContain("残る側");
    expect((await listConnections(b)).map((c) => c.id)).toContain(id);
  });

  it("履歴を消しても、同じ相手と新しくつながり直せる(不変条件7)", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: -49, graceInH: -1 });
    await advanceExpiries();
    await deleteHistoryForMe(a, id);

    const again = await establishConnection(a, b, 7);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.connectionId).not.toBe(id);
  });
});

describe("計測から個人が特定できない(D-3 / 憲法第二条)", () => {
  it("継続確認の計測に userId も connectionId も載らない", async () => {
    const { a, b, id } = await newChat();
    await shiftDeadline(id, { expiresInH: 1, graceInH: 49 });

    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    await chooseRenewal(a, id, "end");
    await chooseRenewal(b, id, "continue");
    spy.mockRestore();

    const emitted = lines.filter((l) => l.includes("[analytics]")).join("\n");
    expect(emitted).toContain("renewal_choice");
    // ここにIDが混ざると、「継続しない」を選んだのが誰かを突き合わせられてしまう
    expect(emitted).not.toContain(a);
    expect(emitted).not.toContain(b);
    expect(emitted).not.toContain(id);
  });
});

import { describe, expect, it } from "vitest";
import { checkHandleFormat, RESERVED_HANDLES } from "@/lib/handle-format";

describe("checkHandleFormat", () => {
  it("正しいIDを受け入れる", () => {
    for (const v of ["satoshi", "abc", "a_1", "a".repeat(20), "user_123"]) {
      expect(checkHandleFormat(v), v).toEqual({ ok: true });
    }
  });

  it("全角が混ざったら日本語入力をオフにする案内を出す", () => {
    // A-2 の必須要件。「使えない文字です」では日本語キーボードのままだと気づけない
    const r = checkHandleFormat("さ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("non_ascii");
    expect(r.message).toContain("日本語入力をオフ");
  });

  it("全角英数も non_ascii として扱う", () => {
    const r = checkHandleFormat("ｓａｔｏｓｈｉ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("non_ascii");
  });

  it("半角の使えない記号は別メッセージにする", () => {
    const r = checkHandleFormat("sato-shi");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid_chars");
      expect(r.message).not.toContain("日本語入力");
    }
  });

  it("大文字を弾く(UI側で小文字化する前提)", () => {
    const r = checkHandleFormat("Satoshi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_chars");
  });

  it("長さの境界", () => {
    expect(checkHandleFormat("ab").ok).toBe(false);
    expect(checkHandleFormat("abc").ok).toBe(true);
    expect(checkHandleFormat("a".repeat(20)).ok).toBe(true);
    expect(checkHandleFormat("a".repeat(21)).ok).toBe(false);
  });

  it("空文字はエラー扱いだがメッセージを出さない(入力前だから)", () => {
    const r = checkHandleFormat("");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("empty");
      expect(r.message).toBe("");
    }
  });

  it("予約語を拒否する", () => {
    for (const v of ["admin", "api", "support", "personallink", "settings"]) {
      const r = checkHandleFormat(v);
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.reason).toBe("reserved");
    }
  });

  it("予約語リストが handle の形式規則を満たす(DBのCHECK制約と矛盾しない)", () => {
    for (const h of RESERVED_HANDLES) {
      expect(/^[a-z0-9_]{1,20}$/.test(h), h).toBe(true);
    }
  });
});

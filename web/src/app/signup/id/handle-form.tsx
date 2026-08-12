"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAccount, type FormState } from "@/app/actions/auth";
import { checkHandleFormat } from "@/lib/handle-format";

/** どの入力に対する結果かを持たせ、古い応答が新しい入力に紐づかないようにする */
type Availability = { handle: string; ok: boolean; message: string };

/**
 * @ID 入力(A-2)。
 *
 * **日本語入力(IME)対応が必須**(仕様書 A-2)。守ること:
 *   1. 変換中(compositionstart〜compositionend)は値に触れない。触ると変換状態が壊れる
 *   2. 全角が入ったら「使えない文字」ではなく、日本語入力をオフにする案内を出す
 *   3. autocapitalize / autocorrect / spellcheck を切る
 */
export function HandleForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createAccount, {});
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Availability | null>(null);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const format = checkHandleFormat(value);
  // 今の入力に対する結果だけを採用する(状態を消す副作用を持たなくて済む)
  const availability = result?.handle === value ? result : null;
  const checking = format.ok && !availability;

  // 形式が通ったものだけサーバーへ問い合わせる(打鍵ごとに叩かない)
  useEffect(() => {
    if (!checkHandleFormat(value).ok) return;
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/handle/check?handle=${encodeURIComponent(value)}`, {
          signal: ac.signal,
        });
        const body = (await res.json()) as { ok: boolean; message: string };
        setResult({ handle: value, ok: body.ok, message: body.message });
      } catch {
        // 中断や通信エラーは表示を変えない(送信時にサーバーが最終判定する)
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [value]);

  /** 変換中は呼ばない。大文字だけその場で小文字化する(長さが変わらずカーソルを保てる)。 */
  function normalize() {
    const el = inputRef.current;
    if (!el) return;
    const lower = el.value.replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (lower !== el.value) {
      const pos = el.selectionStart;
      el.value = lower;
      if (pos !== null) el.setSelectionRange(pos, pos);
    }
    setValue(el.value.trim());
  }

  const ready = format.ok && availability?.ok === true;
  const message = !format.ok
    ? format.message
    : checking
      ? "確認中…"
      : (availability?.message ?? "");
  const tone = !format.ok
    ? format.reason === "empty"
      ? ""
      : " hint-error"
    : availability
      ? availability.ok
        ? " hint-ok"
        : " hint-error"
      : "";

  return (
    <form action={action} className="stack">
      <div>
        <div className="handle-row">
          <span className="at" aria-hidden="true">@</span>
          <input
            ref={inputRef}
            name="handle"
            className="field"
            defaultValue=""
            placeholder="satoshi"
            type="text"
            lang="en"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="handle-msg"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              normalize();
            }}
            onInput={(e) => {
              // React の onInput は nativeEvent.isComposing を持つ
              if ((e.nativeEvent as InputEvent).isComposing || composing.current) return;
              normalize();
            }}
            onBlur={normalize}
          />
        </div>
        <p className="hint">3〜20文字 / 英小文字・数字・アンダースコア</p>
        <p id="handle-msg" className={`hint${tone}`} aria-live="polite">
          {message}
        </p>
      </div>

      <p className="hint">
        💡 表示名(ニックネーム)は次の画面で別に設定できます。IDに本名を使う必要はありません。
      </p>

      {state.error && <p className="hint hint-error">{state.error}</p>}

      <button type="submit" className="btn btn-primary" disabled={!ready || pending}>
        {pending ? "作成中…" : "次へ"}
      </button>
    </form>
  );
}

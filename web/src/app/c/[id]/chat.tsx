"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageView } from "@/lib/message";
import { hideForMe, poll, reload, retract, send } from "@/app/actions/chat";
import { MessageSheet } from "./message-sheet";

const POLL_INTERVAL_MS = 3000;

/**
 * C-1 チャット本体。
 *
 * **既読表示はしない**(D-8)。表示するのは「送信済み」だけ。
 * **ミュートの印は自分の吹き出しにしか付かない**(D-13)。サーバーが受信側に返さないので、
 * ここで気をつける必要すらない設計になっている。
 */
export function Chat({
  connectionId,
  initial,
  canSend,
  status,
}: {
  connectionId: string;
  initial: MessageView[];
  canSend: boolean;
  status: "active" | "grace" | "permanent" | "expired";
}) {
  const [items, setItems] = useState<MessageView[]>(initial);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<MessageView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const sending = useRef(false);

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [items, scrollToEnd]);

  // ポーリングで差分を取る(T-5)。SSE へはこの中身を差し替えるだけで移行できる。
  // カーソルは**エフェクト内のローカル変数**として持つ。ref を外から共有すると、
  // 「エフェクトが依存する値をエフェクト内で書き換える」形になってしまう。
  useEffect(() => {
    let alive = true;
    let since: string | null = null;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await poll(connectionId, since);
          if (!alive) return;
          // サーバー時刻を次のカーソルにする(端末の時計とズレても取りこぼさない)
          since = r.now;
          if (r.messages.length > 0) setItems((prev) => merge(prev, r.messages));
        } catch {
          // 一時的な失敗は次の周期で回復する
        }
      }
      if (alive) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [connectionId]);

  async function submit() {
    const el = inputRef.current;
    if (!el || sending.current) return;
    const body = el.value.trim();
    if (!body) return;

    sending.current = true;
    el.value = "";
    setError(null);
    try {
      const r = await send(connectionId, body, muted);
      if (r.ok) {
        setItems((prev) => merge(prev, [r.message]));
      } else {
        setError(r.error);
        el.value = body; // 送れなかった内容は戻す
      }
    } finally {
      sending.current = false;
      el.focus();
    }
  }

  async function onRetract(id: string) {
    setSheetFor(null);
    const r = await retract(id);
    if (!r.ok) setError(r.error ?? "取り消せませんでした");
    setItems(await reload(connectionId));
  }

  async function onHide(id: string) {
    setSheetFor(null);
    await hideForMe(id);
    setItems(await reload(connectionId));
  }

  return (
    <>
      <div className="chatlist" ref={listRef}>
        {items.length === 0 && (
          <p className="chatempty">まだメッセージがありません。</p>
        )}
        {items.map((m) => (
          <Bubble key={m.id} m={m} onOpen={() => m.mine && setSheetFor(m)} />
        ))}
      </div>

      {error && <p className="hint hint-error chaterror">{error}</p>}

      {canSend ? (
        <div className="inputbar">
          <button
            type="button"
            className={`mutetoggle${muted ? " on" : ""}`}
            aria-pressed={muted}
            aria-label={muted ? "ミュート送信: オン" : "ミュート送信: オフ"}
            title="ミュートで送ると、相手に通知が鳴りません"
            onClick={() => setMuted((v) => !v)}
          >
            {muted ? "🌙" : "🔔"}
          </button>
          <input
            ref={inputRef}
            className="chatinput"
            placeholder={muted ? "🌙 ミュートで送信" : "メッセージ"}
            autoComplete="off"
            enterKeyHint="send"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              // 変換確定のEnterで誤送信しない(A-2 と同じIME要件)
              if (e.key !== "Enter") return;
              if (e.nativeEvent.isComposing || composing.current) return;
              e.preventDefault();
              void submit();
            }}
          />
          <button type="button" className="send" onClick={() => void submit()} aria-label="送信">
            ➤
          </button>
        </div>
      ) : (
        <div className="endbar">
          {status === "grace"
            ? "期限が終了したため、メッセージは送れません(閲覧はできます)"
            : "この接続は終了しています"}
        </div>
      )}

      {sheetFor && (
        <MessageSheet
          message={sheetFor}
          onClose={() => setSheetFor(null)}
          onRetract={() => void onRetract(sheetFor.id)}
          onHide={() => void onHide(sheetFor.id)}
        />
      )}
    </>
  );
}

function Bubble({ m, onOpen }: { m: MessageView; onOpen: () => void }) {
  if (m.kind === "system") {
    return <div className="msg sys">{m.body}</div>;
  }
  if (m.retracted) {
    return (
      <div className={`msg retracted ${m.mine ? "me" : "them"}`}>送信を取り消しました</div>
    );
  }
  const cls = `msg ${m.mine ? "me" : "them"}`;
  const content = (
    <>
      {/* 本文は独立した要素にする(「送信済み」と同じ要素に混ぜない) */}
      <span className="body">{m.body}</span>
      {m.mine && (
        <span className="st">
          {/* 既読は表示しない(D-8)。ミュートの印は自分の吹き出しにだけ付く(D-13) */}
          {m.muted ? "🌙 ミュートで送信済み" : "送信済み"}
        </span>
      )}
    </>
  );
  return m.mine ? (
    <button type="button" className={cls} onClick={onOpen}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** id で重複を除きつつ時系列に並べる。ポーリングと楽観追加が重なっても壊れない。 */
function merge(prev: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

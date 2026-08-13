"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageView } from "@/lib/message";
import { hideForMe, retract } from "@/app/actions/chat";
import { pollGroup, reloadGroup, sendToGroup } from "@/app/actions/group";
import { MessageSheet } from "@/app/c/[id]/message-sheet";

const POLL_INTERVAL_MS = 3000;

/**
 * G-2 グループチャット本体。
 *
 * 1対1(C-1)との違いは2つだけ:
 *   - 相手の発言に**送信者名**が付く(誰の発言か分からないと読めない)
 *   - 期限・レベルの概念が無い(D-11)
 *
 * 取り消し(D-12)とミュート(D-13)は1対1と**同じ実装**を使う。
 * 分けると片方だけ直して片方が取り残される。
 */
export function GroupChat({
  groupId,
  initial,
}: {
  groupId: string;
  initial: MessageView[];
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

  useEffect(() => {
    let alive = true;
    let since: string | null = null;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await pollGroup(groupId, since);
          if (!alive) return;
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
  }, [groupId]);

  async function submit() {
    const el = inputRef.current;
    if (!el || sending.current) return;
    const body = el.value.trim();
    if (!body) return;

    sending.current = true;
    el.value = "";
    setError(null);
    try {
      const r = await sendToGroup(groupId, body, muted);
      if (r.ok) setItems((prev) => merge(prev, [r.message]));
      else {
        setError(r.error);
        el.value = body;
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
    setItems(await reloadGroup(groupId));
  }

  async function onHide(id: string) {
    setSheetFor(null);
    await hideForMe(id);
    setItems(await reloadGroup(groupId));
  }

  return (
    <>
      <div className="chatlist" ref={listRef}>
        {items.length === 0 && <p className="chatempty">まだメッセージがありません。</p>}
        {items.map((m) => (
          <Bubble key={m.id} m={m} onOpen={() => m.mine && setSheetFor(m)} />
        ))}
      </div>

      {error && <p className="hint hint-error chaterror">{error}</p>}

      <div className="inputbar">
        <button
          type="button"
          className={`mutetoggle${muted ? " on" : ""}`}
          aria-pressed={muted}
          aria-label={muted ? "ミュート送信: オン" : "ミュート送信: オフ"}
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
  if (m.kind === "system") return <div className="msg sys">{m.body}</div>;
  if (m.retracted) {
    return <div className={`msg retracted ${m.mine ? "me" : "them"}`}>送信を取り消しました</div>;
  }

  const cls = `msg ${m.mine ? "me" : "them"}`;
  const content = (
    <>
      {/* グループでは誰の発言かを出す。1対1では自明なので出さない */}
      {m.senderName && <span className="who">{m.senderName}</span>}
      <span className="body">{m.body}</span>
      {m.mine && (
        <span className="st">{m.muted ? "🌙 ミュートで送信済み" : "送信済み"}</span>
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

/** id で重複を除きつつ時系列に並べる(C-1 と同じ)。 */
function merge(prev: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

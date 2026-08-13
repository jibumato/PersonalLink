"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MessageView } from "@/lib/message";
import {
  deleteHistory,
  hideForMe,
  poll,
  reload,
  retract,
  send,
  sendAttachmentAction,
} from "@/app/actions/chat";
import { MessageSheet } from "./message-sheet";
import { ProposalCard } from "./proposal-card";

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
  canAttach,
  pendingProposal,
}: {
  connectionId: string;
  initial: MessageView[];
  canSend: boolean;
  status: "active" | "grace" | "permanent" | "expired";
  /** Lv.2 が解放されているか(不変条件2)。サーバー側でも必ず再確認する */
  canAttach: boolean;
  /** 相手からの未承諾の提案(C-2)。自分が閉じたものは渡ってこない */
  pendingProposal: { level: number; label: string } | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MessageView[]>(initial);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<MessageView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  /** 添付の送信(不変条件2)。ゲートはサーバーが持つ */
  async function onPickFile(file: File) {
    setError(null);
    const form = new FormData();
    form.set("connectionId", connectionId);
    form.set("muted", muted ? "1" : "0");
    form.set("file", file);
    const r = await sendAttachmentAction(form);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // 添付IDはサーバーで採番されるので、取り直して確実に描く
    setItems(await reload(connectionId));
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

  /** D-3 履歴削除。消したあとは開けなくなるので、ホームへ戻す */
  async function onDeleteHistory() {
    setConfirmDelete(false);
    const r = await deleteHistory(connectionId);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.replace("/home");
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
        {/* C-2 相手からの提案。承諾するまで何も解放されない(D-5) */}
        {pendingProposal && (
          <ProposalCard
            connectionId={connectionId}
            level={pendingProposal.level}
            label={pendingProposal.label}
          />
        )}
      </div>

      {error && <p className="hint hint-error chaterror">{error}</p>}

      {canSend ? (
        <div className="inputbar">
          {/* Lv.2 が解放されていないときはボタン自体を出さない(C-2 へ誘導する) */}
          {canAttach && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                aria-label="写真・ファイルを選ぶ"
                accept="image/*,.pdf,.txt,.zip,.doc,.docx,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onPickFile(f);
                }}
              />
              <button
                type="button"
                className="mutetoggle"
                aria-label="写真・ファイルを送る"
                onClick={() => fileRef.current?.click()}
              >
                📎
              </button>
            </>
          )}
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
      ) : status === "grace" ? (
        <div className="endbar">期限が終了したため、メッセージは送れません(閲覧はできます)</div>
      ) : (
        // D-3 終了状態。入力バーの代わりに履歴削除を置く(憲法第六条)
        <div className="endbar">
          <span>この接続は終了しています</span>
          <button type="button" className="linkbtn" onClick={() => setConfirmDelete(true)}>
            履歴を削除
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="amodal" onClick={() => setConfirmDelete(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="履歴の削除"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>履歴を削除しますか?</h3>
            <div className="stack">
              <p className="hint">
                この会話があなたの側から完全に消えます。<strong>元に戻せません。</strong>
                相手の履歴には影響しません(憲法第六条)。
              </p>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onDeleteHistory()}
              >
                履歴を削除する
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmDelete(false)}
              >
                やめる
              </button>
            </div>
          </div>
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
      {/* 共有が停止された添付。ファイル名も出さない(T-6) */}
      {m.locked && <span className="body locked">🔒 共有が停止されています</span>}
      {/* 添付。取り消されると行ごと消えるので、ここに来ることはない(D-12) */}
      {m.attachment &&
        (m.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- 参加者チェック付きの動的配信のため最適化を通さない
          <img
            className="msgimg"
            src={`/api/a/${m.attachment.id}`}
            alt={m.attachment.filename}
          />
        ) : (
          <a className="msgfile" href={`/api/a/${m.attachment.id}`} download>
            📎 {m.attachment.filename}
          </a>
        ))}
      {/* 本文は独立した要素にする(「送信済み」と同じ要素に混ぜない) */}
      {m.kind !== "image" && !m.attachment && <span className="body">{m.body}</span>}
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

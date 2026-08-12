"use client";

import { useEffect, useRef } from "react";
import type { MessageView } from "@/lib/message";

/**
 * C-3 メッセージ操作メニュー。
 *
 * 「送信取り消し」と「自分の画面から削除」は**別物**なので、
 * 常に両方を並べて違いを明記する(D-12)。片方だけ出すと取り違える。
 */
export function MessageSheet({
  message,
  onClose,
  onRetract,
  onHide,
}: {
  message: MessageView;
  onClose: () => void;
  onRetract: () => void;
  onHide: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="amodal" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="メッセージの操作"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>メッセージ</h3>
        <div className="stack">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!message.canRetract || message.retracted}
            onClick={onRetract}
          >
            送信を取り消す
          </button>
          <p className="hint">
            {message.retracted
              ? "すでに取り消し済みです"
              : message.canRetract
                ? "相手の画面からも消えます。内容はサーバーからも削除され、相手に通知されません。"
                : "送信から24時間以内のみ取り消せます"}
          </p>

          <button type="button" className="btn btn-secondary" onClick={onHide}>
            自分の画面から削除
          </button>
          <p className="hint">相手の画面には残ります。</p>

          <button type="button" className="btn btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

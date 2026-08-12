"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * B-5 Connection成立。
 *
 * 成立を祝い、すぐ会話へ促す。**初回メッセージ率**(KPI)に直結する画面なので、
 * 「あとで」より「メッセージを送る」を主役にする。
 * チャット(C-1)は S3 で実装するため、今はホームへ戻る。
 *
 * 表示名には**敬称を付け足さない**。ユーザーが自由に決める値なので、
 * 「ホストさん」に「さん」を足して「ホストさんさん」になる事故が起きる。
 */
export function Established({ name, days }: { name: string; days: number | null }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function close() {
    router.replace("/home");
  }

  return (
    <div className="ovl" role="dialog" aria-modal="true" aria-label="接続が成立しました">
      <div className="ovlbox">
        <div className="pair" aria-hidden="true">
          <span className="dot">🙂</span>
          <span className="wire" />
          <span className="dot">🔗</span>
        </div>
        <p className="ovltitle">{name} とつながりました</p>
        {days && <span className="badge badge-warn">⏳ {days}日間</span>}
        <p className="hint">電話番号・メール・LINE IDは共有されていません</p>
        <div className="stack" style={{ marginTop: "1.1rem" }}>
          {/* チャットは S3。それまではホームへ戻す */}
          <button ref={ref} type="button" className="btn btn-primary" onClick={close}>
            OK
          </button>
        </div>
        <p className="hint">チャット(C-1)は S3 で実装します。</p>
      </div>
    </div>
  );
}

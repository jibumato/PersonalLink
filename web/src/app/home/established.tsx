"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * B-5 Connection成立。
 *
 * 成立を祝い、すぐ会話へ促す。**初回メッセージ率**(KPI)に直結する画面なので、
 * 「あとで」より「メッセージを送る」を主役にする。
 *
 * 表示名には**敬称を付け足さない**。ユーザーが自由に決める値なので、
 * 「ホストさん」に「さん」を足して「ホストさんさん」になる事故が起きる。
 */
export function Established({
  name,
  days,
  connectionId,
}: {
  name: string;
  days: number | null;
  connectionId: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement>(null);

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
          {/* 「あとで」より会話を主役にする。初回メッセージ率(KPI)に直結する */}
          <Link ref={ref} href={`/c/${connectionId}`} className="btn btn-primary">
            メッセージを送る
          </Link>
          <button type="button" className="btn btn-ghost" onClick={close}>
            あとで
          </button>
        </div>
      </div>
    </div>
  );
}

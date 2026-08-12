"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { confirmConnect, peekConnectTarget, type PeekResult, type ConnectResult } from "@/app/actions/connect";
import { useHash } from "@/lib/use-hash";

/**
 * B-4 接続確認。**サービスの思想が最も凝縮される画面**。
 * 「何が共有され、何が共有されないか」を接続前に明示する。
 */
export function ConfirmClient() {
  const payload = useHash();
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [state, action, pending] = useActionState<ConnectResult, FormData>(confirmConnect, {});

  useEffect(() => {
    if (!payload) return;
    let alive = true;
    void peekConnectTarget(payload).then((r) => {
      if (alive) setPeek(r);
    });
    return () => {
      alive = false;
    };
  }, [payload]);

  const failure =
    payload === "" ? "QRの情報が読み取れませんでした" : peek && !peek.ok ? peek.message : null;

  if (failure) {
    return (
      <div className="panel" style={{ textAlign: "center" }}>
        <h1>接続できませんでした</h1>
        <p className="lede">{failure}</p>
        <div className="stack" style={{ marginTop: "1.2rem" }}>
          <Link href="/qr?tab=scan" className="btn btn-secondary">もう一度読み取る</Link>
          <Link href="/home" className="btn btn-ghost">ホームへ</Link>
        </div>
      </div>
    );
  }

  if (!peek?.ok || !payload) {
    return (
      <div className="panel" style={{ textAlign: "center" }}>
        <p className="lede">確認しています…</p>
      </div>
    );
  }

  const target = peek.target;

  return (
    <>
      <div className="panel" style={{ textAlign: "center" }}>
        <p className="eyebrow">Connect</p>
        <h1>{target.displayName ?? `@${target.handle}`}</h1>
        <p className="lede mono">@{target.handle}</p>
        {target.bio && <p className="lede">「{target.bio}」</p>}
      </div>

      <div className="panel">
        <ul className="cond">
          <li>
            <span aria-hidden="true">⏳</span>
            <span>
              <strong>期限: {target.expiryDays}日間</strong>
              <span className="sub">期限が来る前に、継続するか選べます</span>
            </span>
          </li>
          <li>
            <span aria-hidden="true">🔓</span>
            <span>共有されるもの: <strong>公開プロフィールのみ</strong></span>
          </li>
          <li>
            <span aria-hidden="true">🔒</span>
            <span className="muted">
              共有されないもの: <strong className="lock">電話番号・メールアドレス・LINE ID</strong>
            </span>
          </li>
        </ul>
      </div>

      {state.error && <p className="hint hint-error">{state.error}</p>}

      <form action={action} className="stack">
        <input type="hidden" name="payload" value={payload} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "接続中…" : "つながる"}
        </button>
      </form>
      {/* 「やめる」を選んでも、表示側には何も通知しない(D-3と同じ沈黙の原則) */}
      <Link href="/qr?tab=scan" className="btn btn-ghost">やめる</Link>
    </>
  );
}

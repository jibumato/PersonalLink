"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import { refreshQrToken, setPreferredExpiryDays } from "@/app/actions/connect";
import type { QrExpiryDays } from "@/db/schema";

type Token = { payload: string; expiresAt: string; expiryDays: number };

const CHOICES: QrExpiryDays[] = [1, 7, 30];

/**
 * B-2 マイQR表示。
 *
 * 「連絡先を渡す」のではなく「**接続条件を提示する**」画面。
 * トークンは5分で失効するので、失効前に自動で作り直す(D-2)。
 */
export function QrPanel({
  initial,
  expiryDays,
  handle,
  displayName,
}: {
  initial: Token;
  expiryDays: QrExpiryDays;
  handle: string;
  displayName: string;
}) {
  const [token, setToken] = useState<Token>(initial);
  const [svg, setSvg] = useState<string>("");
  const [remaining, setRemaining] = useState(300);
  const [days, setDays] = useState<QrExpiryDays>(expiryDays);
  const [pending, startTransition] = useTransition();
  const wakeRef = useRef<() => void>(() => {});

  // QRの中身は `<origin>/i#<token>`。フラグメントなのでサーバーに送信されない(lib/qr.ts)
  const url = useMemo(
    () => (typeof window === "undefined" ? "" : `${window.location.origin}/i#${token.payload}`),
    [token.payload],
  );

  useEffect(() => {
    if (!url) return;
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#16323c", light: "#ffffff" },
    }).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  // 残り時間の表示と、失効前の自動更新
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.round((Date.parse(token.expiresAt) - Date.now()) / 1000));
      setRemaining(left);
      // 15秒前に取り直す。読み取り中に失効するのを避けるため
      if (left <= 15) wakeRef.current();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [token.expiresAt]);

  useEffect(() => {
    let running = false;
    wakeRef.current = () => {
      if (running) return;
      running = true;
      refreshQrToken()
        .then((t) => setToken(t))
        .finally(() => {
          running = false;
        });
    };
  }, []);

  function changeDays(d: QrExpiryDays) {
    setDays(d);
    startTransition(async () => {
      await setPreferredExpiryDays(d);
      setToken(await refreshQrToken());
    });
  }

  const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <>
      <div className="panel">
        <p className="eyebrow">My QR</p>
        <div className="qrbox">
          {svg ? (
            <div
              className="qrsvg"
              role="img"
              aria-label="接続用のQRコード"
              /* QRと同じ内容。E2Eから読めるようにしてある(画像内と同じ情報で、自分の画面にしか出ない) */
              data-url={url}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="qrsvg" aria-hidden="true" />
          )}
        </div>
        <p className="ttl mono">
          🔄 このQRはあと {mm}:{ss} で自動更新されます
        </p>
        <p style={{ textAlign: "center", margin: ".6rem 0 0" }}>
          <strong>{displayName}</strong>{" "}
          <span className="mono" style={{ color: "var(--muted)", fontSize: ".82rem" }}>
            @{handle}
          </span>
        </p>
      </div>

      <div className="panel">
        <h2>接続の期限</h2>
        <div className="chips" role="group" aria-label="接続の期限">
          {CHOICES.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${days === d ? " on" : ""}`}
              aria-pressed={days === d}
              // 反映が終わるまで押せないようにする(古い期限のQRを配ってしまわないため)
              disabled={pending}
              onClick={() => changeDays(d)}
            >
              {d}日
            </button>
          ))}
        </div>
        <p className="hint" style={{ textAlign: "center" }}>
          読み取った相手とは <strong>Level 1(メッセージのみ)</strong> でつながります
        </p>
      </div>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { resolveScan } from "@/app/actions/connect";

type State =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "denied" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/**
 * B-3 QR読み取り。
 *
 * 標準のカメラアプリからも読める形式にしてあるが(lib/qr.ts)、
 * アプリ内から読み取りたい場合のための画面。
 * カメラが使えないときのために **@ID入力のフォールバック** を必ず併設する。
 */
export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const handledRef = useRef(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "unsupported" });
      return;
    }
    setState({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setState({ kind: "scanning" });
      loop();
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setState(
        name === "NotAllowedError"
          ? { kind: "denied" }
          : { kind: "error", message: "カメラを起動できませんでした" },
      );
    }
  }

  function loop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = (canvas.width = video.videoWidth);
      const h = (canvas.height = video.videoHeight);
      if (w && h) {
        ctx.drawImage(video, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
          inversionAttempts: "dontInvert",
        });
        if (code?.data) {
          void handle(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  async function handle(raw: string) {
    if (handledRef.current) return;
    handledRef.current = true;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());

    // QRの中身は `<origin>/i#<token>`。フラグメント部分を取り出す
    const payload = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
    const outcome = await resolveScan(payload);

    if (outcome.kind === "confirm") {
      router.push(`/connect/confirm#${payload}`);
    } else if (outcome.kind === "connected") {
      router.push("/home?already=1");
    } else if (outcome.kind === "signup") {
      router.push("/welcome");
    } else {
      setNotice(outcome.message);
      handledRef.current = false;
      setState({ kind: "idle" });
    }
  }

  return (
    <>
      <div className="panel">
        <p className="eyebrow">Scan</p>
        <div className="cam">
          <video ref={videoRef} playsInline muted />
          <div className="camframe" aria-hidden="true" />
          {state.kind !== "scanning" && <p className="camhint">相手のQRを読み取ってください</p>}
        </div>
        <canvas ref={canvasRef} hidden />

        {notice && <p className="hint hint-error">{notice}</p>}

        <div className="stack" style={{ marginTop: ".9rem" }}>
          {state.kind !== "scanning" && (
            <button type="button" className="btn btn-primary" onClick={start}>
              {state.kind === "starting" ? "起動中…" : "📷 カメラを起動"}
            </button>
          )}
          {state.kind === "denied" && (
            <p className="hint hint-error">
              カメラの使用が許可されていません。ブラウザの設定から許可するか、下のIDで接続してください。
            </p>
          )}
          {state.kind === "unsupported" && (
            <p className="hint hint-error">
              この環境ではカメラを使えません。下のIDで接続してください。
            </p>
          )}
          {state.kind === "error" && <p className="hint hint-error">{state.message}</p>}
        </div>
      </div>

      <div className="panel">
        <h2>IDで接続</h2>
        <p className="hint">
          カメラが使えないときはこちら。QRと違い、相手の承認が必要です。
        </p>
        <HandleFallback />
      </div>
    </>
  );
}

function HandleFallback() {
  const [message, setMessage] = useState<string | null>(null);
  const [handle, setHandle] = useState("");

  return (
    <div className="stack" style={{ marginTop: ".7rem" }}>
      <div className="handle-row">
        <span className="at" aria-hidden="true">@</span>
        <input
          className="field"
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase())}
          placeholder="tanaka_photo"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      {message && <p className="hint">{message}</p>}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() =>
          setMessage(
            "ID接続は相手の承認が必要です(QRと違い、その場で許可を得た文脈がないため)。この機能は S5 で実装します。",
          )
        }
        disabled={!handle}
      >
        接続をリクエスト
      </button>
    </div>
  );
}

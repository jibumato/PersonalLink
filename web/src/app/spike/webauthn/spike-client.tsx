"use client";

import { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  browserSupportsWebAuthnAutofill,
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import styles from "./spike.module.css";

type Support = {
  webauthn: boolean;
  platformAuthenticator: boolean;
  conditionalUI: boolean;
  secureContext: boolean;
  host: string;
};

type LogEntry = { at: string; level: "ok" | "err" | "info"; text: string };

export function SpikeClient() {
  const [support, setSupport] = useState<Support | null>(null);
  const [busy, setBusy] = useState<null | "register" | "auth">(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [credential, setCredential] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void (async () => {
      setSupport({
        webauthn: browserSupportsWebAuthn(),
        platformAuthenticator: await platformAuthenticatorIsAvailable().catch(() => false),
        conditionalUI: await browserSupportsWebAuthnAutofill().catch(() => false),
        secureContext: window.isSecureContext,
        host: window.location.host,
      });
    })();
  }, []);

  function push(level: LogEntry["level"], text: string) {
    setLog((prev) => [
      { at: new Date().toLocaleTimeString("ja-JP", { hour12: false }), level, text },
      ...prev,
    ]);
  }

  async function register() {
    setBusy("register");
    try {
      const optRes = await fetch("/api/spike/webauthn/register/options", { method: "POST" });
      const { options, rpID } = await optRes.json();
      push("info", `登録オプション取得 (RP ID: ${rpID})`);

      const attestation = await startRegistration({ optionsJSON: options });
      push("info", "認証器から応答を受け取りました。検証中…");

      const verifyRes = await fetch("/api/spike/webauthn/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const result = await verifyRes.json();

      if (result.ok) {
        setCredential(result.credential);
        push(
          "ok",
          `登録成功 — 種別: ${result.credential.deviceType ?? "?"} / 同期バックアップ: ${
            result.credential.backedUp ? "あり" : "なし"
          }`,
        );
      } else {
        push("err", `登録失敗: ${result.error}`);
      }
    } catch (e) {
      push("err", `登録中断: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function authenticate() {
    setBusy("auth");
    try {
      const optRes = await fetch("/api/spike/webauthn/auth/options", { method: "POST" });
      const { options } = await optRes.json();
      push("info", "認証オプション取得(ID入力なしのログインを試行)");

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/spike/webauthn/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const result = await verifyRes.json();

      if (result.ok) {
        push(
          "ok",
          `認証成功 — 生体/PIN確認: ${result.userVerified ? "あり" : "なし"} / counter: ${result.counter}`,
        );
      } else {
        push("err", `認証失敗: ${result.error}`);
      }
    } catch (e) {
      push("err", `認証中断: ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className={styles.card}>
        <h2>この端末の対応状況</h2>
        {support ? (
          <ul className={styles.checks}>
            <Check ok={support.secureContext} label="安全なコンテキスト (HTTPS / localhost)" />
            <Check ok={support.webauthn} label="WebAuthn に対応" />
            <Check
              ok={support.platformAuthenticator}
              label="端末内蔵の認証器 (Face ID / 指紋 / PIN)"
            />
            <Check
              ok={support.conditionalUI}
              label="Conditional UI (入力欄からの自動サジェスト)"
              optional
            />
            <li className={styles.meta}>RP ID になるホスト: {support.host}</li>
          </ul>
        ) : (
          <p className={styles.meta}>確認中…</p>
        )}
      </section>

      <section className={styles.card}>
        <h2>検証手順</h2>
        <ol className={styles.steps}>
          <li>「Passkey を作成」を押し、Face ID / 指紋 / PIN で承認する</li>
          <li>「Passkey でログイン」を押し、ID を入力せずに認証できるか確認する</li>
          <li>ブラウザを完全に終了して開き直し、もう一度「Passkey でログイン」を試す</li>
        </ol>
        <div className={styles.actions}>
          <button onClick={register} disabled={busy !== null} className={styles.primary}>
            {busy === "register" ? "作成中…" : "Passkey を作成"}
          </button>
          <button onClick={authenticate} disabled={busy !== null} className={styles.secondary}>
            {busy === "auth" ? "認証中…" : "Passkey でログイン"}
          </button>
        </div>
        {credential && (
          <dl className={styles.cred}>
            <dt>種別</dt>
            <dd>
              {credential.deviceType === "multiDevice"
                ? "multiDevice(iCloud / Google に同期される)"
                : "singleDevice(この端末のみ)"}
            </dd>
            <dt>転送方式</dt>
            <dd>{(credential.transports as string[])?.join(", ") || "—"}</dd>
          </dl>
        )}
      </section>

      <section className={styles.card}>
        <h2>ログ</h2>
        {log.length === 0 ? (
          <p className={styles.meta}>まだ操作していません。</p>
        ) : (
          <ul className={styles.log}>
            {log.map((e, i) => (
              <li key={i} className={styles[e.level]}>
                <time>{e.at}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Check({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  return (
    <li className={ok ? styles.ok : optional ? styles.warn : styles.err}>
      <span aria-hidden="true">{ok ? "✓" : optional ? "△" : "✕"}</span>
      {label}
    </li>
  );
}

function errText(e: unknown): string {
  if (e instanceof Error) {
    // NotAllowedError はユーザーがキャンセルした場合にも出る。実機で最も混乱するので明示する。
    if (e.name === "NotAllowedError") {
      return "キャンセルされたか、タイムアウトしました (NotAllowedError)";
    }
    return `${e.name}: ${e.message}`;
  }
  return String(e);
}

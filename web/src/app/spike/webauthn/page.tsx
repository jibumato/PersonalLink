import type { Metadata } from "next";
import { SpikeClient } from "./spike-client";
import styles from "./spike.module.css";

export const metadata: Metadata = {
  title: "WebAuthn スパイク | PersonalLink",
  robots: { index: false, follow: false },
};

/**
 * S0のWebAuthn実機検証ページ(T-10)。
 * ROADMAPのリスク「WebAuthn実機互換」を潰すために、実機のブラウザで開いて操作する。
 */
export default function Page() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <span className={styles.tag}>S0 SPIKE</span>
        <h1>Passkey 実機検証</h1>
        <p>
          この端末で Passkey を作成し、そのまま再認証できるかを確認します。
          ROADMAP のリスク「WebAuthn 実機互換」を検証するための一時的なページです。
        </p>
      </header>
      <SpikeClient />
    </main>
  );
}

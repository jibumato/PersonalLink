import Link from "next/link";
import styles from "./page.module.css";

/** S0の疎通確認ページ。S1でウェルカム画面(A-1)に差し替える。 */
export default function Home() {
  return (
    <main className={styles.main}>
      <span className={styles.tag}>PHASE 1 / S0</span>
      <h1>PersonalLink</h1>
      <p className={styles.copy}>LINEを教える前に、つながろう。</p>
      <p className={styles.status}>
        環境構築の疎通確認ページです。画面の実装は S1(認証基盤)から始まります。
      </p>
      <nav className={styles.nav}>
        <Link href="/spike/webauthn">→ WebAuthn 実機検証 (S0スパイク)</Link>
        <Link href="/api/health">→ ヘルスチェック</Link>
      </nav>
    </main>
  );
}

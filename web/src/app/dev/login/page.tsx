import { notFound } from "next/navigation";
import { devLoginEnabled } from "@/lib/dev-auth";
import { DevLoginForm } from "./dev-login-form";

/**
 * 有効・無効は実行時の環境変数で決まる。静的化されるとビルド時の値が焼き込まれ、
 * 環境ごとの判定ができなくなるため、必ずリクエストごとに評価させる。
 */
export const dynamic = "force-dynamic";

/**
 * 開発用の仮ログイン。認証方式([D-7](../../../../docs/01-screen-design.md))が
 * 決まるまでの踏み台で、S2以降の開発を止めないために置いている。
 *
 * 本番では画面自体が存在しない(404)。
 */
export default function DevLoginPage() {
  if (!devLoginEnabled()) notFound();

  return (
    <main className="shell">
      <div className="notice">
        ⚠️ これは開発用の仮ログインです。@ID を入力するだけで、そのアカウントになれます。
        本番環境では無効化されます。
      </div>
      <div className="panel">
        <p className="eyebrow">Dev only</p>
        <h1>仮ログイン</h1>
        <p className="lede">既存の @ID を入力してください。</p>
        <div style={{ marginTop: "1.2rem" }}>
          <DevLoginForm />
        </div>
      </div>
    </main>
  );
}

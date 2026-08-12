import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ProfileForm } from "./profile-form";

/** A-4 プロフィール設定(Level 0 = 公開)。 */
export default async function SignupProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");

  return (
    <main className="shell">
      <div className="panel">
        <p className="eyebrow">Step 2 / 2</p>
        <h1>プロフィール</h1>
        <p className="lede">@{user.handle} として表示される情報です。</p>
        <div style={{ marginTop: "1.2rem" }}>
          <ProfileForm defaultName={user.displayName ?? ""} />
        </div>
      </div>
      <div className="panel">
        <p style={{ margin: 0, fontSize: ".8rem", color: "var(--muted)" }}>
          ここに入力した内容は <strong>Level 0(公開)</strong> です。
          あなたのQRを読み取った相手に表示されます。
          <strong>それ以外の情報は、あなたが許可するまで誰にも共有されません。</strong>
        </p>
      </div>
    </main>
  );
}

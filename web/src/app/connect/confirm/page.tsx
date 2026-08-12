import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ConfirmClient } from "./confirm-client";

/**
 * B-4 接続確認。
 *
 * トークンはフラグメントにあるためサーバーからは読めない。
 * クライアントが読み取り、Server Action で相手の公開プロフィールを取得する。
 */
export const dynamic = "force-dynamic";

export default async function ConfirmPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  return (
    <main className="shell" style={{ justifyContent: "center" }}>
      <ConfirmClient />
    </main>
  );
}

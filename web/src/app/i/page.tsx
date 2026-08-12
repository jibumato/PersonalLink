import { InviteClient } from "./invite-client";

/**
 * QRのURLを開いたときの着地点。
 *
 * QRの中身は `<origin>/i#<token>`。**トークンはフラグメント**にあるので、
 * サーバーには送信されない(アクセスログに残らない)。クライアントで読み取って
 * サーバーへ渡す(lib/qr.ts)。
 */
export const dynamic = "force-dynamic";

export default function InvitePage() {
  return (
    <main className="shell" style={{ justifyContent: "center" }}>
      <InviteClient />
    </main>
  );
}

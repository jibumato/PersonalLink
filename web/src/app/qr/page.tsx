import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPreferredExpiryDays, refreshQrToken } from "@/app/actions/connect";
import { QrPanel } from "./qr-panel";
import { Scanner } from "./scanner";

/** B-2 マイQR表示 / B-3 QR読み取り。 */
export default async function QrPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/welcome");
  if (!user.displayName) redirect("/signup/profile");

  const { tab } = await searchParams;
  const scanning = tab === "scan";
  const expiryDays = await getPreferredExpiryDays();
  // 表示タブのときだけ発行する(読み取りタブで無駄なトークンを作らない)
  const initial = scanning ? null : await refreshQrToken();

  return (
    <main className="shell">
      <nav className="tabs" aria-label="QR">
        <Link href="/qr" className={scanning ? "" : "on"} aria-current={scanning ? undefined : "page"}>
          マイQR
        </Link>
        <Link href="/qr?tab=scan" className={scanning ? "on" : ""} aria-current={scanning ? "page" : undefined}>
          読み取り
        </Link>
      </nav>

      {scanning ? (
        <Scanner />
      ) : (
        <QrPanel
          initial={initial!}
          expiryDays={expiryDays}
          handle={user.handle}
          displayName={user.displayName}
        />
      )}

      <p className="linkrow">
        <Link href="/home">← ホームへ</Link>
      </p>
    </main>
  );
}

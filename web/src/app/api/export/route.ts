import { getCurrentUser } from "@/lib/session";
import { exportAccount } from "@/lib/account";

/**
 * F-2 データエクスポート(憲法第六条)。
 *
 * 申請でも問い合わせでもなく、**その場でダウンロードできる**ようにする。
 * 「持ち出せる」が実感できて初めて、この会社を信頼しなくてよい(憲法第十条)が成り立つ。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const data = await exportAccount(user.userId);
  const filename = `personallink-${user.handle}-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { advanceExpiries } from "@/lib/renewal";

/**
 * 期限の状態遷移ジョブ(T-8)。Vercel Cron から定期的に叩く。
 *
 * 読み取り時の遅延評価と**二重化**されているので、このジョブが遅れても
 * ユーザーの見え方は正しいまま。ここが担うのは、誰も画面を開いていない
 * Connection の後始末とタイムラインへの記録。
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 本番では必ず秘密を設定する。設定がある場合のみ検証する(ローカルでは素通し)
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await advanceExpiries();
  return NextResponse.json({ ok: true, ...result });
}

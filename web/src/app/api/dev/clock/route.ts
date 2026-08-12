import { NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { connectionMembers, connections } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { devLoginEnabled } from "@/lib/dev-auth";

/**
 * 開発用の時計送り。**E2Eのためだけに存在する。**
 *
 * 期限エンジン(S4)は「7日後」を扱うので、実時間を待っていては検証できない。
 * 時計を進める代わりに、Connection の期限を過去へずらす。
 *
 * ⚠️ **本番では存在しない(404)。** 仮ログインと同じ [devLoginEnabled](../../../../lib/dev-auth.ts)
 * で判定し、さらに二重で守る:
 *   - ログイン必須
 *   - **自分が参加している** Connection しか動かせない
 *   - 恒久は対象外(不変条件3。期限を持てない)
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!devLoginEnabled()) return new NextResponse(null, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as {
    connectionId?: string;
    expiresInHours?: number;
    graceInHours?: number;
  };
  const { connectionId, expiresInHours, graceInHours } = body;
  if (!connectionId || typeof expiresInHours !== "number" || typeof graceInHours !== "number") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const db = await getDb();
  const [member] = await db
    .select({ userId: connectionMembers.userId })
    .from(connectionMembers)
    .where(
      and(
        eq(connectionMembers.connectionId, connectionId),
        eq(connectionMembers.userId, user.userId),
        isNull(connectionMembers.hiddenAt),
      ),
    )
    .limit(1);
  if (!member) return new NextResponse(null, { status: 404 });

  const now = Date.now();
  const updated = await db
    .update(connections)
    .set({
      status: "active",
      endedAt: null,
      expiresAt: new Date(now + expiresInHours * 3600_000),
      graceUntil: new Date(now + graceInHours * 3600_000),
    })
    .where(and(eq(connections.id, connectionId), ne(connections.status, "permanent")))
    .returning({ id: connections.id });

  return NextResponse.json({ ok: true, shifted: updated.length });
}

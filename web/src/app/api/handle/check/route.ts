import { NextResponse } from "next/server";
import { checkHandleAvailable } from "@/lib/handle";

/**
 * @ID の可用性チェック(A-2 のリアルタイム表示用)。
 *
 * 入力中に叩かれるため、**総当たりで既存IDを列挙されないよう** 判定結果だけを返す
 * (ユーザーIDなどは一切返さない)。
 */
export async function GET(req: Request) {
  const handle = new URL(req.url).searchParams.get("handle") ?? "";
  if (handle.length > 64) {
    return NextResponse.json({ ok: false, message: "20文字までです" });
  }
  const result = await checkHandleAvailable(handle);
  return NextResponse.json(
    result.ok
      ? { ok: true, message: "✓ このIDは利用できます" }
      : { ok: false, message: result.message, reason: result.reason },
    { headers: { "cache-control": "no-store" } },
  );
}

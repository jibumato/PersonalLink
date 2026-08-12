import { NextResponse } from "next/server";
import { requestContext } from "@/lib/request-context";

/** デプロイの疎通確認。 */
export async function GET(req: Request) {
  const { host, origin } = requestContext(req);
  return NextResponse.json({ ok: true, phase: "1", sprint: "S0", host, origin });
}

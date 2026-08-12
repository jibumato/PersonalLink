import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { CHALLENGE_COOKIE, resolveRpId, seal } from "@/lib/spike-session";
import { requestContext } from "@/lib/request-context";

export async function POST(req: Request) {
  const { host } = requestContext(req);

  const options = await generateAuthenticationOptions({
    rpID: resolveRpId(host),
    // allowCredentials を空にすることで discoverable credential(resident key)を使う。
    // = 「@IDを入力せずにログインできる」の検証。A-1の「ログイン」ボタン1つで済ませたい。
    allowCredentials: [],
    userVerification: "preferred",
  });

  const res = NextResponse.json({ options });
  res.cookies.set(CHALLENGE_COOKIE, seal(options.challenge), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
  return res;
}

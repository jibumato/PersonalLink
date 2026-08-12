import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  CHALLENGE_COOKIE,
  CREDENTIAL_COOKIE,
  resolveRpId,
  seal,
  unseal,
  type SpikeCredential,
} from "@/lib/spike-session";
import { readCookie, requestContext } from "@/lib/request-context";

export async function POST(req: Request) {
  const { host } = requestContext(req);
  const rpID = resolveRpId(host);

  const existing = unseal<SpikeCredential>(
    readCookie(req.headers.get("cookie"), CREDENTIAL_COOKIE),
  );

  const options = await generateRegistrationOptions({
    rpName: "PersonalLink (spike)",
    rpID,
    // S1では users.id / users.handle になる。スパイクは固定値で足りる。
    userName: "spike-user",
    userDisplayName: "スパイク検証ユーザー",
    attestationType: "none", // 憲法第二条: 端末を識別しうる情報を受け取らない
    authenticatorSelection: {
      residentKey: "required", // ID入力なしでログインできること(A-3の要件)
      userVerification: "preferred",
    },
    // 同じ端末に二重登録させない
    excludeCredentials: existing ? [{ id: existing.id }] : [],
  });

  const res = NextResponse.json({ options, rpID });
  res.cookies.set(CHALLENGE_COOKIE, seal(options.challenge), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });
  return res;
}

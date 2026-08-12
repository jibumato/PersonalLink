import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
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
  const { host, origin } = requestContext(req);
  const cookie = req.headers.get("cookie");

  const expectedChallenge = unseal<string>(readCookie(cookie, CHALLENGE_COOKIE));
  const stored = unseal<SpikeCredential>(readCookie(cookie, CREDENTIAL_COOKIE));

  if (!expectedChallenge) {
    return NextResponse.json(
      { ok: false, error: "チャレンジが見つかりません。もう一度お試しください。" },
      { status: 400 },
    );
  }
  if (!stored) {
    return NextResponse.json(
      { ok: false, error: "この端末にはまだPasskeyが登録されていません。" },
      { status: 400 },
    );
  }

  const body = (await req.json()) as AuthenticationResponseJSON;

  if (body.id !== stored.id) {
    return NextResponse.json(
      { ok: false, error: "登録済みのPasskeyと一致しません。" },
      { status: 400 },
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: resolveRpId(host),
      requireUserVerification: false,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "検証に失敗しました" },
      { status: 400 },
    );
  }

  if (!verification.verified) {
    return NextResponse.json({ ok: false, error: "検証に失敗しました" }, { status: 400 });
  }

  // 署名カウンタを進める(リプレイ検知。Passkeyでは0のままの実装も多い)
  const updated: SpikeCredential = {
    ...stored,
    counter: verification.authenticationInfo.newCounter,
  };

  const res = NextResponse.json({
    ok: true,
    counter: updated.counter,
    userVerified: verification.authenticationInfo.userVerified,
  });
  res.cookies.set(CREDENTIAL_COOKIE, seal(updated), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}

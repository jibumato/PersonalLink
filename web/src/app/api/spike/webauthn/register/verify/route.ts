import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
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
  const expectedChallenge = unseal<string>(
    readCookie(req.headers.get("cookie"), CHALLENGE_COOKIE),
  );
  if (!expectedChallenge) {
    return NextResponse.json(
      { ok: false, error: "チャレンジが見つかりません。もう一度お試しください。" },
      { status: 400 },
    );
  }

  const body = (await req.json()) as RegistrationResponseJSON;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: resolveRpId(host),
      requireUserVerification: false, // 実機の差を観察するため、スパイクでは緩める
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "検証に失敗しました" },
      { status: 400 },
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ ok: false, error: "検証に失敗しました" }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  const stored: SpikeCredential = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: body.response.transports,
    // singleDevice / multiDevice。multiDevice = iCloudキーチェーン等で同期される
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    registeredAt: new Date().toISOString(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  };

  const res = NextResponse.json({ ok: true, credential: publicView(stored) });
  res.cookies.set(CREDENTIAL_COOKIE, seal(stored), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.delete(CHALLENGE_COOKIE);
  return res;
}

/** 画面に出す用。公開鍵そのものは返さない(見せる意味がないため)。 */
function publicView(c: SpikeCredential) {
  return {
    id: c.id,
    counter: c.counter,
    transports: c.transports,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    registeredAt: c.registeredAt,
  };
}

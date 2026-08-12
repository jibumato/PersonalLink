/**
 * リクエストからホストとプロトコルを取り出す。
 *
 * WebAuthnは RP ID(ホスト)と origin の一致を検証するため、
 * リバースプロキシ(Vercel)越しでも正しい値を得る必要がある。
 */
export function requestContext(req: Request): { host: string; proto: string; origin: string } {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { host, proto, origin: `${proto}://${host}` };
}

/** Cookieヘッダから1つ取り出す。 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

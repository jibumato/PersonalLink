/**
 * S0 WebAuthnスパイク専用の状態保持(T-10)。
 *
 * 目的は「iOS Safari / Android Chrome でPasskeyが作れて認証できるか」の一点だけを、
 * インフラ無しで実機検証できるようにすること。
 *
 * - チャレンジと公開鍵を署名付きHttpOnly Cookieに置くのでDBが要らない
 * - サーバーレスの複数インスタンス間で状態が共有できない問題も回避できる
 * - 公開鍵は秘密情報ではないためCookie保持で問題ない
 *
 * S1で credentials / sessions テーブルへ置き換える。このファイルはその時点で削除する。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SPIKE_SECRET ?? "dev-only-insecure-secret";

export const CHALLENGE_COOKIE = "pl_spike_challenge";
export const CREDENTIAL_COOKIE = "pl_spike_credential";

/** スパイクで保持する登録済みPasskey。S1では credentials テーブルの1行になる。 */
export type SpikeCredential = {
  /** WebAuthn credential ID (base64url) */
  id: string;
  /** COSE公開鍵 (base64url) */
  publicKey: string;
  counter: number;
  /** 実機の挙動を見るために記録する検証用メタデータ */
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  registeredAt: string;
  userAgent?: string;
};

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** 値をHMAC署名付きの文字列にする(改ざん検知のため。秘匿はしていない)。 */
export function seal(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** seal した文字列を検証して復元する。改ざん・不正形式は null。 */
export function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  const idx = sealed.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = sealed.slice(0, idx);
  const mac = sealed.slice(idx + 1);

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

/**
 * RP ID を実行時のホストから決める。
 *
 * 本番(S1以降)ではこれを環境変数で固定する。Passkeyはこの値に紐づくため、
 * 一度公開したあとに変えると既存の全Passkeyが無効になる(T-2)。
 */
export function resolveRpId(host: string): string {
  return host.split(":")[0];
}

export function resolveOrigin(host: string, proto: string): string {
  return `${proto}://${host}`;
}

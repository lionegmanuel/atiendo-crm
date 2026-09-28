/**
 * Edge-runtime-safe HMAC verifier for the impersonate cookie.
 *
 * Mirrors the verification logic of `cookie.ts` but uses Web Crypto SubtleCrypto
 * because Next.js middleware runs in the Edge runtime where `node:crypto` is
 * not available. Signing is *not* exposed here — only the server runtime mints
 * cookies (`cookie.ts`).
 *
 * Tradeoff: Web Crypto has no `timingSafeEqual`. We implement a constant-time
 * compare manually over equal-length byte arrays.
 */
// Local edge-safe re-declaration to avoid pulling node:crypto from cookie.ts
// into the middleware bundle.
export const IMPERSONATE_COOKIE_NAME_EDGE = "deskcomm-impersonate";

export interface ImpersonatePayload {
  tenantId: string;
  platformAdminId: string;
  exp: number;
}

export interface EdgeVerifyResult {
  valid: boolean;
  payload?: ImpersonatePayload;
  reason?:
    | "missing_secret"
    | "malformed"
    | "invalid_signature"
    | "expired"
    | "invalid_payload";
}

function b64urlToBytes(s: string): Uint8Array {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyImpersonateCookieEdge(
  token: string,
  secret: string,
): Promise<EdgeVerifyResult> {
  if (!secret || secret.length < 32) {
    return { valid: false, reason: "missing_secret" };
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = parts;

  let providedSig: Uint8Array;
  try {
    providedSig = b64urlToBytes(sigB64);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const enc = new TextEncoder();
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    return { valid: false, reason: "missing_secret" };
  }
  const expectedSigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const expectedSig = new Uint8Array(expectedSigBuf);

  if (!constantTimeEqual(providedSig, expectedSig)) {
    return { valid: false, reason: "invalid_signature" };
  }

  let payload: ImpersonatePayload;
  try {
    const bytes = b64urlToBytes(payloadB64);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ImpersonatePayload).tenantId !== "string" ||
      typeof (parsed as ImpersonatePayload).platformAdminId !== "string" ||
      typeof (parsed as ImpersonatePayload).exp !== "number"
    ) {
      return { valid: false, reason: "invalid_payload" };
    }
    payload = parsed as ImpersonatePayload;
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}

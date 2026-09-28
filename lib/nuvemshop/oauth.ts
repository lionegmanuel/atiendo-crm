/**
 * Nuvemshop (Tiendanube) OAuth helpers + HMAC SHA256 webhook signature.
 *
 * Endpoints (verified against partners.tiendanube.com docs, 2026-04):
 *  - Authorize: https://www.tiendanube.com/apps/{app_id}/authorize
 *  - Token:     https://www.tiendanube.com/apps/authorize/token
 *  - Webhook signature header: x-linkedstore-hmac-sha256, hex digest of body
 *    using app's client_secret as the HMAC key.
 *  - Token response `user_id` IS the storeId. Tokens never expire.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  APP_USER_AGENT,
  NUVEMSHOP_AUTH_BASE,
  type NuvemshopConfig,
} from "./config";

export interface AuthorizeUrlInput {
  appId: string;
  state: string;
}

export function buildAuthorizeUrl({ appId, state }: AuthorizeUrlInput): string {
  // Nuvemshop's authorize URL doesn't require state, but we always include it
  // as a CSRF defense. The callback validates and rejects unknown state tokens.
  const url = new URL(`${NUVEMSHOP_AUTH_BASE}/apps/${encodeURIComponent(appId)}/authorize`);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface TokenSuccess {
  ok: true;
  accessToken: string;
  scope: string;
  storeId: string;
}

export interface TokenFailure {
  ok: false;
  error: string;
  status?: number;
  raw?: string;
}

export type TokenResult = TokenSuccess | TokenFailure;

interface RawTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  user_id?: number | string;
}

export async function exchangeCodeForToken(
  code: string,
  cfg: NuvemshopConfig,
): Promise<TokenResult> {
  const body = JSON.stringify({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
  });

  let res: Response;
  try {
    res = await fetch(`${NUVEMSHOP_AUTH_BASE}/apps/authorize/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": APP_USER_AGENT,
      },
      body,
      // OAuth token endpoints must never be cached.
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, error: "network_error", raw: (err as Error).message };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: "token_exchange_failed", status: res.status, raw: text };
  }

  let parsed: RawTokenResponse;
  try {
    parsed = JSON.parse(text) as RawTokenResponse;
  } catch {
    return { ok: false, error: "invalid_token_response", raw: text };
  }

  if (!parsed.access_token || parsed.user_id === undefined || parsed.user_id === null) {
    return { ok: false, error: "invalid_token_response", raw: text };
  }

  return {
    ok: true,
    accessToken: parsed.access_token,
    scope: parsed.scope ?? "",
    storeId: String(parsed.user_id),
  };
}

/**
 * Verify Nuvemshop webhook HMAC SHA256 signature.
 *
 * @param rawBody    The exact request body string (must NOT be re-stringified).
 * @param signatureHex  Value of `x-linkedstore-hmac-sha256` header (hex digest).
 * @param clientSecret  The app's client_secret used as HMAC key.
 */
export function verifyHmac(
  rawBody: string,
  signatureHex: string | null | undefined,
  clientSecret: string,
): boolean {
  if (!signatureHex) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHex.trim(), "hex");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

/**
 * Helper for tests / local debugging — produces the same signature Nuvemshop
 * would send. Hex digest matches `verifyHmac`.
 */
export function signWebhook(rawBody: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("hex");
}

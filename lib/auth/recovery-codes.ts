/**
 * Recovery code generator. Single-use 8-char codes from an ambiguity-free
 * alphabet (no 0/O, 1/I/L). Rejection sampling avoids modulo bias.
 *
 * Codes are stored as sha256(code) bytea in `user_recovery_codes`.
 */
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 31 chars, ambiguity-free
const CODE_LEN = 8;
const CODE_COUNT = 10;

// Reject bytes >= MAX_VALID to avoid modulo bias (256 % 31 != 0).
const MAX_VALID = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

export function generateRecoveryCode(): string {
  let out = "";
  while (out.length < CODE_LEN) {
    const buf = randomBytes(CODE_LEN);
    for (let i = 0; i < buf.length && out.length < CODE_LEN; i++) {
      const b = buf[i];
      if (b !== undefined && b < MAX_VALID) {
        out += ALPHABET[b % ALPHABET.length];
      }
    }
  }
  return out;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: CODE_COUNT }, () => generateRecoveryCode());
}

export function hashRecoveryCode(code: string): Buffer {
  return createHash("sha256").update(code).digest();
}

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role } from "./types.ts";

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  role: Role;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function signJwt(
  claims: Omit<JwtClaims, "iat" | "exp">,
  secret: string,
  expiresInSeconds = 60 * 60 * 12
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = {
    ...claims,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const headerSegment = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest();
  const providedSig = base64UrlDecode(signatureSegment);
  if (expectedSig.length !== providedSig.length) return null;
  if (!timingSafeEqual(expectedSig, providedSig)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadSegment).toString("utf8")) as JwtClaims;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

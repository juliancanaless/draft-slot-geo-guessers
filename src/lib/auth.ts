import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity } from "./types";

export const IDENTITY_COOKIE = "draft_slot_identity";

export function createClaimToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseIdentity(request: Request): Identity | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${IDENTITY_COOKIE}=`))
    ?.slice(IDENTITY_COOKIE.length + 1);
  const value = bearer ?? (cookie ? decodeURIComponent(cookie) : null);
  if (!value) return null;
  const [playerId, token] = value.split(".");
  if (!playerId || !token) return null;
  return { playerId, token };
}

export function identityCookie(identity: Identity, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${IDENTITY_COOKIE}=${encodeURIComponent(`${identity.playerId}.${identity.token}`)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
}

export function adminAuthorized(request: Request) {
  const expected = process.env.ADMIN_SECRET;
  const supplied = request.headers.get("x-admin-secret");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

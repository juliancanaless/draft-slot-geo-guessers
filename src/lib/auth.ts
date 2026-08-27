import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity } from "./types";

export function createClaimToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseIdentity(request: Request): Identity | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const [playerId, token] = authorization.slice(7).split(".");
  if (!playerId || !token) return null;
  return { playerId, token };
}

export function adminAuthorized(request: Request) {
  const expected = process.env.ADMIN_SECRET;
  const supplied = request.headers.get("x-admin-secret");
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

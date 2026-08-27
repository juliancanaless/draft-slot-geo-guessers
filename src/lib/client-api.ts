import type { Identity } from "./types";

export const IDENTITY_STORAGE_KEY = "draft-slot-thunderdome-identity";

export function readIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(IDENTITY_STORAGE_KEY) ?? "null") as Identity | null;
    return value?.playerId && value?.token ? value : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: Identity | null) {
  if (identity) localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  else localStorage.removeItem(IDENTITY_STORAGE_KEY);
}

export async function apiFetch<T>(url: string, init: RequestInit = {}, identity = readIdentity()): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (identity) headers.set("Authorization", `Bearer ${identity.playerId}.${identity.token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

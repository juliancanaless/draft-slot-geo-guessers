import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  var __draftSlotSupabase: SupabaseClient | undefined;
}

export function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured.");
  }

  if (!globalThis.__draftSlotSupabase) {
    globalThis.__draftSlotSupabase = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "draft-slot-geo-guessers" } },
    });
  }
  return globalThis.__draftSlotSupabase;
}

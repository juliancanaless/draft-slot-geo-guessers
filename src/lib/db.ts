import "server-only";
import postgres, { type Sql } from "postgres";

declare global {
  var __draftSlotSql: Sql | undefined;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function db(): Sql {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!globalThis.__draftSlotSql) {
    globalThis.__draftSlotSql = postgres(connectionString, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalThis.__draftSlotSql;
}

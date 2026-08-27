import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = contents.split(/\r?\n/).find((entry) => entry.startsWith("ADMIN_SECRET="));
if (!line) throw new Error("ADMIN_SECRET is missing. Run `vercel env pull .env.local` first.");
const raw = line.slice("ADMIN_SECRET=".length);
const secret = raw.startsWith('"') ? JSON.parse(raw) : raw;
const result = spawnSync("pbcopy", { input: secret, encoding: "utf8" });
if (result.status !== 0) throw new Error("Could not copy the admin secret to the macOS clipboard.");
console.log("Admin secret copied to clipboard without printing it.");

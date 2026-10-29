#!/usr/bin/env bun
/**
 * generateEnvFile — create or fill missing values in .env
 *
 * Preserves existing values. Only generates passwords/secrets for missing fields.
 * Derived fields are rebuilt from their component values.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const genSecret = (len = 64) => crypto.randomBytes(len).toString("hex");

type Ctx = Record<string, string>;

interface FieldDef {
  default?: string;
  generate?: () => string;
  derive?: (ctx: Ctx) => string;
}

const fields: [string, FieldDef][] = [
  ["NODE_ENV", { default: "development" }],

  // `ops dev db up` writes DATABASE_URL, AUTH_DATABASE_URL, SHADOW_DATABASE_URL and
  // TEST_DATABASE_URL; the visitor role name follows the cartridge database name.
  ["DATABASE_VISITOR", { default: "dfg_rocks_visitor" }],

  ["PORT", { default: "3000" }],
  ["VITE_ROOT_URL", { derive: (c) => `http://localhost:${c.PORT}` }],
  ["SECRET", { generate: genSecret }],
  ["ADMIN_EMAIL", { default: "danielfgray@gmail.com" }],
  ["GOOGLE_CALENDAR_CLIENT_ID", { default: "" }],
  ["GOOGLE_CALENDAR_CLIENT_SECRET", { default: "" }],
  ["GOOGLE_CLIENT_ID", { default: "" }],
  ["GOOGLE_CLIENT_SECRET", { default: "" }],
  ["APPLE_CLIENT_ID", { default: "" }],
  ["APPLE_TEAM_ID", { default: "" }],
  ["APPLE_KEY_ID", { default: "" }],
  ["APPLE_PRIVATE_KEY", { default: "" }],
];

const DOTENV_PATH = path.resolve(import.meta.dir, "..", ".env");

const parseDotenv = (content: string): Ctx =>
  content.split("\n").reduce<Ctx>((acc, line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    return m ? { ...acc, [m[1]]: m[2] } : acc;
  }, {});

const resolveField = (key: string, def: FieldDef, existing: Ctx, resolved: Ctx): string => {
  if (def.derive) return def.derive(resolved);
  if (existing[key]) return existing[key];
  if (def.generate) return def.generate();
  return def.default ?? "";
};

let existing: Ctx = {};
try {
  existing = parseDotenv(fs.readFileSync(DOTENV_PATH, "utf-8"));
} catch {}

const resolved = fields.reduce<Ctx>(
  (ctx, [key, def]) => ({ ...ctx, [key]: resolveField(key, def, existing, ctx) }),
  {},
);

// Preserve extra user-added keys
const knownKeys = new Set(fields.map(([k]) => k));
const extras = Object.fromEntries(Object.entries(existing).filter(([k]) => !knownKeys.has(k)));
const merged = { ...resolved, ...extras };

const content = Object.entries(merged)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n")
  .concat("\n");

fs.writeFileSync(DOTENV_PATH, content);
const action = Object.keys(existing).length > 0 ? "Updated" : "Wrote";
console.log(`${action} .env`);

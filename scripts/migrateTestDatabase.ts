import { loadEnvFile } from "node:process";
import { migrateTestDatabase } from "./testDatabase.js";

// Entry for test scripts with no setup hook of their own (bun test); run it inside `ops dev db test`.
loadEnvFile();
migrateTestDatabase();

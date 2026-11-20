import { loadEnvFile } from "node:process";
import { migrateTestDatabase } from "../../scripts/testDatabase.js";

loadEnvFile();

export default function setup() {
  migrateTestDatabase();
}

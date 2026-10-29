import { loadEnvFile } from "node:process";
import { resetTestDatabase } from "../../scripts/testDatabase.js";

loadEnvFile();

export default function setup() {
  resetTestDatabase();
}

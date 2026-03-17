import Redis from "ioredis";
import { env } from "./assertEnv.js";

export const valkey = new Redis(env.VALKEY_URL);

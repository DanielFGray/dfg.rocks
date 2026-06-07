import { env } from "../server/assertEnv.ts";

export default {
  connectionString: env.DATABASE_URL,
  taskDirectory: `${import.meta.dirname}/tasks`,
};

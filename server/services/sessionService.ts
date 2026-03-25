import crypto from "crypto";
import type { UserRole } from "../../shared/schemas.js";
import { rootDb } from "../db.js";
import { valkey } from "../valkey.js";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionKey(id: string) {
  return `dfg:session:${id}`;
}

function generateSecureRandomString(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return result === 0;
}

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

export type SessionInfo = {
  id: string;
  cookie_id: string;
  user_id: string;
};

export type SessionResult = { user: SessionUser; session: SessionInfo } | null;

export const sessionService = {
  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "role", "name"])
      .where("id", "=", userId)
      .executeTakeFirst();

    if (!user) throw new Error(`User ${userId} not found`);

    const id = generateSecureRandomString();
    const secret = generateSecureRandomString();
    const secretHash = hashSecret(secret).toString("hex");
    const sessionUuid = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const key = sessionKey(id);
    await valkey.hset(key, {
      secret_hash: secretHash,
      session_uuid: sessionUuid,
      user_id: user.id,
      username: user.username,
      name: user.name ?? "",
      role: user.role,
    });
    await valkey.expire(key, SESSION_TTL_SECONDS);

    await rootDb
      .insertInto("app_private.sessions")
      .values({
        id: sessionUuid,
        user_id: user.id,
        expires_at: expiresAt,
      })
      .execute();

    return { token: `${id}.${secret}`, expiresAt };
  },

  async validateSessionToken(token?: string): Promise<SessionResult> {
    if (!token) return null;

    const [id, secret] = token.split(".");
    if (!id || !secret) return null;

    const data = await valkey.hgetall(sessionKey(id));
    if (!data?.secret_hash) return null;

    const incomingHash = hashSecret(secret);
    const storedHash = Buffer.from(data.secret_hash, "hex");
    if (!constantTimeEqual(incomingHash, storedHash)) return null;

    return {
      user: {
        id: data.user_id!,
        username: data.username!,
        name: data.name ?? "",
        role: data.role! as UserRole,
      },
      session: {
        id: data.session_uuid!,
        cookie_id: id,
        user_id: data.user_id!,
      },
    };
  },

  async deleteSession(cookieId: string): Promise<void> {
    const key = sessionKey(cookieId);
    const sessionUuid = await valkey.hget(key, "session_uuid");
    await valkey.del(key);
    if (sessionUuid) {
      await rootDb
        .deleteFrom("app_private.sessions")
        .where("id", "=", sessionUuid)
        .execute();
    }
  },

  /** Delete all Valkey session keys for a user. PG sessions are handled by
   *  the reset_password SQL function via cascade or direct delete. */
  async deleteAllUserSessionsFromCache(userId: string): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await valkey.scan(cursor, "MATCH", "dfg:session:*", "COUNT", 100);
      await Promise.all(
        keys.map(async (key) => {
          const uid = await valkey.hget(key, "user_id");
          if (uid === userId) await valkey.del(key);
        }),
      );
      cursor = next;
    } while (cursor !== "0");
  },
} as const;

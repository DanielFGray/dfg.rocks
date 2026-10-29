import crypto from "crypto";
import { Effect, Option, Context, Layer } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import { UserRole } from "../../shared/schemas.js";
import { PgRootDB } from "../db.js";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const decodeUserRole = S.decodeUnknownSync(UserRole);

function generateSecureRandomString(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

function hashSecret(secret: string) {
  return crypto.createHash("sha256").update(secret).digest();
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseSessionToken(token?: string) {
  if (!token) {
    return null;
  }

  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  return {
    cookieId: token.slice(0, separatorIndex),
    secret: token.slice(separatorIndex + 1),
  };
}

function buildToken() {
  const cookieId = generateSecureRandomString();
  const secret = generateSecureRandomString();

  return {
    cookieId,
    secret,
    secretHash: hashSecret(secret),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
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
  active_student_id: string | null;
};

export type SessionResult = { user: SessionUser; session: SessionInfo } | null;

export type EffectiveStudentContext = {
  studentId: string;
  isActing: boolean;
};

export function resolveEffectiveStudent(auth: NonNullable<SessionResult>): EffectiveStudentContext {
  const isParent = auth.user.role === "parent";
  const activeStudentId = auth.session.active_student_id;
  if (isParent && activeStudentId) {
    return { studentId: activeStudentId, isActing: true };
  }
  return { studentId: auth.user.id, isActing: false };
}

class SessionUserNotFoundError extends S.TaggedError<SessionUserNotFoundError>()(
  "SessionUserNotFoundError",
  { userId: S.String },
) {
  get message(): string {
    return `User ${this.userId} not found`;
  }
}

class SessionNotFoundError extends S.TaggedError<SessionNotFoundError>()("SessionNotFoundError", {
  sessionId: S.String,
}) {
  get message(): string {
    return `Session ${this.sessionId} not found`;
  }
}

type LiveSessionRecord = {
  session_id: string;
  cookie_id: string;
  secret_hash_hex: string;
  user_id: string;
  username: string;
  name: string | null;
  role: UserRole;
  expires_at: Date;
  active_student_id: string | null;
};

const loadLiveSessionByCookieIdEffect = Effect.fnUntraced(function* (cookieId: string) {
  const rootDb = yield* PgRootDB;
  return yield* rootDb
    .execute(
      rootDb
        .selectFrom("app_private.sessions as s")
        .innerJoin("app_public.users as u", "u.id", "s.user_id")
        .select([
          "s.id as session_id",
          "s.cookie_id",
          "s.user_id",
          "s.expires_at",
          "s.active_student_id",
          "u.username",
          "u.name",
          "u.role",
        ])
        .select(sql<string>`encode(${sql.ref("s.secret_hash")}, 'hex')`.as("secret_hash_hex"))
        .where("s.cookie_id", "=", cookieId),
    )
    .pipe(
      Effect.head,
      Effect.option,
      Effect.map((row) => Option.getOrNull(row) as LiveSessionRecord | null),
    );
});

export class SessionService extends Context.Service<SessionService>()("SessionService", {
  make: Effect.gen(function* () {
    const db = yield* PgRootDB;
    return {
      createSession: Effect.fnUntraced(function* (userId: string) {
        const user = yield* db
          .execute(db.selectFrom("app_public.users").select(["id"]).where("id", "=", userId))
          .pipe(Effect.head, Effect.option);

        if (Option.isNone(user)) {
          return yield* Effect.fail(new SessionUserNotFoundError({ userId }));
        }

        const { cookieId, secret, secretHash, expiresAt } = buildToken();

        yield* db.execute(
          db.insertInto("app_private.sessions").values({
            user_id: userId,
            cookie_id: cookieId,
            secret_hash: secretHash,
            expires_at: expiresAt,
          }),
        );

        return { token: `${cookieId}.${secret}`, expiresAt };
      }),
      issueTokenForSession: Effect.fnUntraced(function* (sessionId: string) {
        const { cookieId, secret, secretHash, expiresAt } = buildToken();

        const row = yield* db
          .execute(
            db
              .updateTable("app_private.sessions")
              .set({
                cookie_id: cookieId,
                secret_hash: secretHash,
                expires_at: expiresAt,
              })
              .where("id", "=", sessionId)
              .returning(["id"]),
          )
          .pipe(Effect.head, Effect.option);

        if (Option.isNone(row)) {
          return yield* Effect.fail(new SessionNotFoundError({ sessionId }));
        }

        return { token: `${cookieId}.${secret}`, expiresAt };
      }),
      validateSessionToken: Effect.fnUntraced(function* (token?: string) {
        const parsed = parseSessionToken(token);
        if (!parsed) {
          return null;
        }

        const liveSession = yield* loadLiveSessionByCookieIdEffect(parsed.cookieId);
        if (!liveSession) {
          return null;
        }

        if (
          !constantTimeEqual(
            hashSecret(parsed.secret),
            Buffer.from(liveSession.secret_hash_hex, "hex"),
          )
        ) {
          return null;
        }

        if (liveSession.expires_at <= new Date()) {
          yield* db.execute(
            db.deleteFrom("app_private.sessions").where("id", "=", liveSession.session_id),
          );
          return null;
        }

        return {
          user: {
            id: liveSession.user_id,
            username: liveSession.username,
            name: liveSession.name ?? "",
            role: decodeUserRole(liveSession.role),
          },
          session: {
            id: liveSession.session_id,
            cookie_id: liveSession.cookie_id,
            user_id: liveSession.user_id,
            active_student_id: liveSession.active_student_id,
          },
        } satisfies Exclude<SessionResult, null>;
      }),

      updateActiveStudent: Effect.fnUntraced(function* (
        sessionId: string,
        studentId: string | null,
      ) {
        yield* db.execute(
          db
            .updateTable("app_private.sessions")
            .set({ active_student_id: studentId })
            .where("id", "=", sessionId),
        );
      }),

      deleteSession: Effect.fnUntraced(function* (cookieId: string) {
        yield* db.execute(db.deleteFrom("app_private.sessions").where("cookie_id", "=", cookieId));
      }),

      deleteAllUserSessions: Effect.fnUntraced(function* (userId: string) {
        yield* db.execute(db.deleteFrom("app_private.sessions").where("user_id", "=", userId));
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

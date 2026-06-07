import pg from "pg";
import { Effect, Option } from "effect";
import { PgRootDB } from "../db.js";
import { env } from "../assertEnv.js";
import { serverRuntime } from "../runtime.js";
import { valkey } from "../valkey.js";

type RealtimePayload = {
  event?: string;
  subject?: string;
};

type QueryKey = readonly string[];

const CHANNEL_QUERY_KEYS: Record<string, QueryKey[]> = {
  "rt:messages": [["messages"]],
  "rt:lessons": [
    ["my-lessons"],
    ["my-lessons", "scheduled"],
    ["available-slots"],
    ["admin-lessons"],
    ["admin", "lessons"],
  ],
  "rt:courses": [
    ["courses"],
    ["admin", "courses"],
    ["admin", "students"],
  ],
  "rt:modules": [
    ["courses"],
    ["admin", "courses"],
  ],
  "rt:materials": [
    ["library"],
    ["courses"],
    ["assignments"],
    ["admin", "courses"],
    ["admin", "students"],
  ],
  "rt:student_materials": [
    ["assignments"],
    ["courses"],
    ["admin", "students"],
  ],
  "rt:module_materials": [
    ["courses"],
    ["assignments"],
    ["library"],
    ["admin", "courses"],
  ],
  "rt:enrollments": [
    ["courses"],
    ["assignments"],
    ["admin", "students"],
    ["admin", "courses"],
  ],
  "rt:family_memberships": [
    ["auth", "user"],
    ["messages"],
    ["assignments"],
    ["courses"],
    ["my-lessons"],
  ],
  "rt:lesson_notes": [
    ["my-lessons"],
    ["my-lesson-notes"],
    ["admin-lessons"],
    ["admin", "lessons"],
  ],
  "rt:practice_logs": [["practice-logs"]],
  "rt:assignment_notes": [["assignment-note"], ["assignments"]],
  "rt:lesson_deposits": [
    ["my-lessons"],
    ["admin-lessons"],
    ["admin", "lessons"],
  ],
  "rt:assignment_progress": [["assignments"]],
  "rt:assignment_reviews": [["assignments"]],
};

function dedupe(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.length > 0))];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function getRootDb() {
  return serverRuntime.runPromise(
    Effect.gen(function* () {
      return yield* PgRootDB;
    }),
  );
}

function runDb<A, E>(effect: Effect.Effect<A, E>) {
  return serverRuntime.runPromise(effect);
}

class RealtimeService {
  private client: pg.Client | null = null;

  private startPromise: Promise<void> | null = null;

  private staffCache: { ids: string[]; expiresAt: number } | null = null;

  async start(): Promise<void> {
    if (this.client) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    client.on("notification", (message) => {
      void this.handleNotification(message.channel, message.payload ?? "");
    });
    client.on("error", (error) => {
      console.error("Realtime PostgreSQL listener error:", error);
    });

    await client.connect();

    try {
      for (const channel of Object.keys(CHANNEL_QUERY_KEYS)) {
        await client.query(`LISTEN ${quoteIdentifier(channel)}`);
      }
      this.client = client;
    } catch (error) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.staffCache = null;

    if (!client) {
      return;
    }

    client.removeAllListeners();
    await client.end().catch(() => undefined);
  }

  private async handleNotification(channel: string, rawPayload: string) {
    const queryKeys = CHANNEL_QUERY_KEYS[channel];
    if (!queryKeys) {
      return;
    }

    let payload: RealtimePayload;
    try {
      payload = JSON.parse(rawPayload) as RealtimePayload;
    } catch {
      return;
    }

    const subject = typeof payload.subject === "string" ? payload.subject : undefined;
    if (!subject) {
      return;
    }

    const userIds = await this.resolveUserIds(channel, subject);
    if (userIds.length === 0) {
      return;
    }

    const message = JSON.stringify({
      event: payload.event ?? channel,
      subject,
      queryKeys,
    });

    await Promise.all(
      userIds.map((userId) => valkey.publish(`rt:user:${userId}`, message)),
    );
  }

  private async getStaffIds(): Promise<string[]> {
    const now = Date.now();
    if (this.staffCache && this.staffCache.expiresAt > now) {
      return this.staffCache.ids;
    }

    const db = await getRootDb();
    const rows = await runDb(
      db
        .selectFrom("app_public.users")
        .select("id")
        .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")])),
    );
    const ids = rows.map((row) => row.id);
    this.staffCache = { ids, expiresAt: now + 30_000 };
    return ids;
  }

  private async expandUserIds(
    baseUserIds: readonly string[],
    options: { includeStaff?: boolean } = {},
  ): Promise<string[]> {
    const userIds = dedupe(baseUserIds);
    const db = await getRootDb();
    const familyIds =
      userIds.length === 0
        ? []
        : (
            await runDb(
              db
                .selectFrom("app_public.family_memberships as fm_source")
                .innerJoin(
                  "app_public.family_memberships as fm_related",
                  "fm_related.family_id",
                  "fm_source.family_id",
                )
                .select("fm_related.user_id")
                .where("fm_source.user_id", "in", userIds),
            )
          ).map((row) => row.user_id);

    const staffIds = options.includeStaff ? await this.getStaffIds() : [];
    return dedupe([...userIds, ...familyIds, ...staffIds]);
  }

  private async studentScopedUserIds(studentId: string): Promise<string[]> {
    return this.expandUserIds([studentId], { includeStaff: true });
  }

  private async usersForCourse(courseId: string): Promise<string[]> {
    const db = await getRootDb();
    const rows = await runDb(
      db
        .selectFrom("app_public.enrollments")
        .select("student_id")
        .where("course_id", "=", courseId),
    );
    return this.expandUserIds(
      rows.map((row) => row.student_id),
      { includeStaff: true },
    );
  }

  private async usersForModule(moduleId: string): Promise<string[]> {
    const db = await getRootDb();
    const rows = await runDb(
      db
        .selectFrom("app_public.module_materials as mm")
        .innerJoin("app_public.modules as m", "m.id", "mm.module_id")
        .innerJoin("app_public.enrollments as e", "e.course_id", "m.course_id")
        .select("e.student_id")
        .where("mm.module_id", "=", moduleId),
    );
    return this.expandUserIds(
      rows.map((row) => row.student_id),
      { includeStaff: true },
    );
  }

  private async usersForMaterial(materialId: string): Promise<string[]> {
    const db = await getRootDb();
    const [directRows, enrolledRows] = await Promise.all([
      runDb(
        db
          .selectFrom("app_public.student_materials")
          .select("student_id")
          .where("material_id", "=", materialId),
      ),
      runDb(
        db
          .selectFrom("app_public.module_materials as mm")
          .innerJoin("app_public.modules as m", "m.id", "mm.module_id")
          .innerJoin("app_public.enrollments as e", "e.course_id", "m.course_id")
          .select("e.student_id")
          .where("mm.material_id", "=", materialId),
      ),
    ]);

    return this.expandUserIds(
      [...directRows, ...enrolledRows].map((row) => row.student_id),
      { includeStaff: true },
    );
  }

  private async usersForLesson(lessonId: string): Promise<string[]> {
    const db = await getRootDb();
    const row = await runDb(
      db
        .selectFrom("app_public.lessons")
        .select("student_id")
        .where("id", "=", lessonId)
        .pipe(Effect.head, Effect.option),
    );
    return Option.match(row, {
      onNone: () => this.getStaffIds(),
      onSome: (lesson) => this.studentScopedUserIds(lesson.student_id),
    });
  }

  private async resolveUserIds(channel: string, subject: string): Promise<string[]> {
    switch (channel) {
      case "rt:messages":
      case "rt:family_memberships":
      case "rt:student_materials":
      case "rt:enrollments":
      case "rt:practice_logs":
      case "rt:assignment_notes":
      case "rt:lessons":
      case "rt:assignment_progress":
      case "rt:assignment_reviews":
        return this.studentScopedUserIds(subject);
      case "rt:courses":
      case "rt:modules":
        return this.usersForCourse(subject);
      case "rt:module_materials":
        return this.usersForModule(subject);
      case "rt:materials":
        return this.usersForMaterial(subject);
      case "rt:lesson_notes":
      case "rt:lesson_deposits":
        return this.usersForLesson(subject);
      default:
        return [];
    }
  }
}

export const realtimeService = new RealtimeService();

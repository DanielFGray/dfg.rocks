import crypto from "crypto";
import fs from "fs/promises";
import { Effect, Option } from "effect";
import { sql } from "kysely";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";
import { HttpError } from "../pgErrors.js";
import { extractNotationTracksFromBytes, NotationService } from "./notationService.js";
import { SessionService } from "./sessionService.js";
import { StorageService } from "./storageService.js";
import { PgRootDB } from "../db.js";

export class TestingService extends Effect.Service<TestingService>()("TestingService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const db = yield* PgRootDB;

    const queries = {
      userIdByUsername: (username: string) =>
        db.selectFrom("app_public.users").select("id").where("username", "=", username),

      createFamily: (values: { slug: string; name: string }) =>
        db.insertInto("app_public.families").values(values).returning(["id", "slug", "name"]),

      familyIdBySlug: (slug: string) =>
        db.selectFrom("app_public.families").select("id").where("slug", "=", slug),

      addFamilyMembership: (values: {
        family_id: string;
        user_id: string;
        is_owner?: boolean;
        is_billing_contact?: boolean;
      }) =>
        db
          .insertInto("app_public.family_memberships")
          .values(values)
          .onConflict((oc) => oc.doNothing()),
    } as const;

    return {
      login: Effect.fnUntraced(function* ({
        username = "test_admin",
        password = "testpassword123",
        role = "admin",
        email = `${username}@test.local`,
        name: _name,
      }: {
        username?: string;
        password?: string;
        role?: "admin" | "teacher" | "student";
        name?: string;
        email?: string;
      }) {
        const name = _name ?? username;

        let userId = yield* queries.userIdByUsername(username).pipe(
          Effect.head,
          Effect.option,
          Effect.map((row) => Option.getOrNull(row)?.id ?? null),
        );

        if (!userId) {
          const created = yield* db
            .selectFrom(
              sql<{ id: string }>`
              app_private.really_create_user(
                ${username}::citext,
                ${name},
                null,
                true,
                ${email}::citext,
                ${password}
              )
            `.as("u"),
            )
            .select("id")
            .pipe(Effect.head);
          userId = created.id;
        }

        if (role !== "student") {
          yield* db.updateTable("app_public.users").set({ role }).where("id", "=", userId);
        }

        yield* db
          .updateTable("app_private.user_secrets")
          .set({ password_hash: sql`crypt(${password}, gen_salt('bf'))` })
          .where("user_id", "=", userId);

        const session = yield* SessionService.createSession(userId);

        return {
          user: {
            id: userId,
            username,
            email,
            name,
            role,
            is_verified: true,
          } as const,
          token: session.token,
          expiresAt: session.expiresAt,
        };
      }),

      setTestimonialReminder: Effect.fnUntraced(function* (values: {
        username: string;
        promptEnabled: boolean;
        nextPromptAt: Date | null;
      }) {
        const user = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        yield* db
          .updateTable("app_private.user_secrets")
          .set({
            testimonial_prompt_enabled: values.promptEnabled,
            testimonial_next_prompt_at: values.nextPromptAt,
          })
          .where("user_id", "=", user.id);
      }),

      clear: Effect.fnUntraced(function* () {
        yield* db.deleteFrom("app_public.families").where("slug", "like", "test-%");
        yield* db.deleteFrom("app_public.users").where("username", "like", "test_%");
        yield* db.deleteFrom("app_public.courses").where("title", "like", "Test:%");

        const testMaterialFiles = yield* db
          .selectFrom("app_public.materials")
          .select(["storage_backend", "storage_key"])
          .where((eb) =>
            eb.or([
              eb("storage_key", "like", "test/%"),
              eb("storage_key", "like", "/test/%"),
              eb("storage_key", "like", "/tmp/test-%"),
            ]),
          );
        yield* db
          .deleteFrom("app_public.materials")
          .where((eb) =>
            eb.or([
              eb("storage_key", "like", "test/%"),
              eb("storage_key", "like", "/test/%"),
              eb("storage_key", "like", "/tmp/test-%"),
            ]),
          );

        yield* Effect.forEach(
          testMaterialFiles.filter((material) => material.storage_backend === "local"),
          (material) =>
            StorageService.delete({
              storageBackend: material.storage_backend,
              storageKey: material.storage_key,
            }).pipe(Effect.catchAll(() => Effect.void)),
          { discard: true },
        );
      }),

      seedCourse: Effect.fnUntraced(function* (
        body: Readonly<{
          title: string;
          instrument: string;
          description?: string;
          modules?: ReadonlyArray<{ title: string; sort_order?: number }>;
        }>,
      ) {
        const course = yield* db
          .insertInto("app_public.courses")
          .values({
            title: body.title,
            instrument: body.instrument,
            description: body.description ?? "",
          })
          .returning(["id", "title", "instrument", "description"])
          .pipe(Effect.head);

        const mods = body.modules ?? [];
        if (mods.length > 0) {
          yield* db.insertInto("app_public.modules").values(
            mods.map((mod, index) => ({
              course_id: course.id,
              title: mod.title,
              sort_order: mod.sort_order ?? index + 1,
            })),
          );
        }

        return course.id;
      }),

      seedMaterial: Effect.fnUntraced(function* (body: {
        title: string;
        original_filename?: string;
        mime_type?: string;
        file_size?: number;
        is_global?: boolean;
        source_file_path?: string;
      }) {
        const originalFilename =
          body.original_filename ?? `${body.title.toLowerCase().replace(/\s+/g, "-")}.pdf`;
        const bytes = body.source_file_path
          ? new Uint8Array(
              yield* Effect.tryPromise({
                try: () => fs.readFile(body.source_file_path!),
                catch: (error) => error,
              }),
            )
          : Buffer.from(
              `test-material:${body.title}:${originalFilename}:${crypto.randomUUID()}`,
              "utf8",
            );

        const location = StorageService.createTestingLocation(originalFilename);
        yield* StorageService.put(location, bytes);

        const notationTracks = body.source_file_path
          ? yield* extractNotationTracksFromBytes(bytes, originalFilename)
          : null;

        const material = yield* db
          .insertInto("app_public.materials")
          .values({
            title: body.title,
            original_filename: originalFilename,
            storage_backend: location.storageBackend,
            storage_key: location.storageKey,
            content_hash: null,
            mime_type: body.mime_type ?? "application/pdf",
            file_size: body.file_size ?? bytes.byteLength,
            is_global: body.is_global ?? false,
            notation_tracks:
              notationTracks === null ? null : sql`${JSON.stringify(notationTracks)}::jsonb`,
          })
          .returning(["id"])
          .pipe(Effect.head);

        return material.id;
      }),

      assignMaterial: Effect.fnUntraced(function* (values: {
        username: string;
        materialTitle: string;
        assignedTrackIndex?: string | null;
      }) {
        const student = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        const material = yield* db
          .selectFrom("app_public.materials")
          .select("id")
          .where("title", "=", values.materialTitle)
          .pipe(Effect.head);
        const assignedTrackIndex = yield* NotationService.resolveAssignedTrackIndex(
          material.id,
          values.assignedTrackIndex ? Number(values.assignedTrackIndex) : undefined,
        );

        yield* db
          .insertInto("app_public.student_materials")
          .values({
            student_id: student.id,
            material_id: material.id,
            assigned_track_index: assignedTrackIndex,
          })
          .onConflict((oc) =>
            oc.columns(["student_id", "material_id"]).doUpdateSet({
              assigned_track_index: assignedTrackIndex,
            }),
          );
        return material.id;
      }),

      enroll: Effect.fnUntraced(function* (values: { username: string; courseTitle: string }) {
        const student = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        const course = yield* db
          .selectFrom("app_public.courses")
          .select("id")
          .where("title", "=", values.courseTitle)
          .pipe(Effect.head);

        yield* db
          .insertInto("app_public.enrollments")
          .values({
            student_id: student.id,
            course_id: course.id,
          })
          .onConflict((oc) => oc.doNothing());
        return course.id;
      }),

      seedFamily: Effect.fnUntraced(function* (values: {
        slug?: string | null;
        name?: string | null;
        ownerUsername?: string | null;
      }) {
        const family = yield* queries
          .createFamily({
            slug: values.slug ?? `test-family-${Date.now()}`,
            name: values.name ?? "Test Family",
          })
          .pipe(Effect.head);

        if (values.ownerUsername) {
          const owner = yield* queries.userIdByUsername(values.ownerUsername).pipe(Effect.head);
          yield* queries.addFamilyMembership({
            family_id: family.id,
            user_id: owner.id,
            is_owner: true,
            is_billing_contact: true,
          });
        }

        return family.id;
      }),

      seedFamilyMembership: Effect.fnUntraced(function* (values: {
        username: string;
        familySlug: string;
        isOwner: boolean;
        isBillingContact: boolean;
      }) {
        const user = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        const family = yield* queries.familyIdBySlug(values.familySlug).pipe(Effect.head);

        yield* queries.addFamilyMembership({
          family_id: family.id,
          user_id: user.id,
          is_owner: values.isOwner,
          is_billing_contact: values.isBillingContact,
        });
      }),

      seedInvitation: Effect.fnUntraced(function* (values: {
        email: string;
        familySlug?: string | null;
        expiresAt?: Date;
      }) {
        let familyId: string;

        if (values.familySlug) {
          const family = yield* queries.familyIdBySlug(values.familySlug).pipe(Effect.head);
          familyId = family.id;
        } else {
          const family = yield* queries
            .createFamily({
              slug: `test-family-${Date.now()}`,
              name: "Test Family",
            })
            .pipe(Effect.head);
          familyId = family.id;

          const admin = yield* db
            .selectFrom("app_public.users")
            .select("id")
            .where("role", "=", "admin")
            .pipe(
              Effect.head,
              Effect.orElseFail(() => new HttpError(500, "No admin user found")),
            );

          yield* queries.addFamilyMembership({
            family_id: familyId,
            user_id: admin.id,
            is_owner: true,
            is_billing_contact: true,
          });
        }

        const code = crypto.randomBytes(7).toString("hex");
        const invitation = yield* db
          .insertInto("app_public.family_invitations")
          .values({
            family_id: familyId,
            email: values.email,
            code,
            ...(values.expiresAt ? { expires_at: values.expiresAt } : {}),
          })
          .returning(["id"])
          .pipe(Effect.head);

        return { invitationId: invitation.id, code };
      }),

      seedDeleteAccount: Effect.fnUntraced(function* (username: string) {
        const user = yield* queries.userIdByUsername(username).pipe(Effect.head);
        const token = crypto.randomBytes(7).toString("hex");
        yield* db
          .updateTable("app_private.user_secrets")
          .set({
            delete_account_token: token,
            delete_account_token_generated: new Date(),
          })
          .where("user_id", "=", user.id);
        return token;
      }),

      seedLesson: Effect.fnUntraced(function* (values: {
        username: string;
        scheduledAt?: string | null;
        durationMinutes: number;
        locationType: LocationType;
        status: LessonStatus;
      }) {
        const student = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        yield* db.insertInto("app_public.lessons").values({
          student_id: student.id,
          scheduled_at: new Date(
            values.scheduledAt ?? new Date(Date.now() + 86400000).toISOString(),
          ),
          duration_minutes: values.durationMinutes,
          location_type: values.locationType,
          status: values.status,
        });
      }),
    };
  }),
}) {}

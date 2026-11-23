import crypto from "crypto";
import fs from "fs/promises";
import { Clock, Effect, Option, Context, Layer } from "effect";
import { sql } from "kysely";
import type { ContentVisibility, LessonStatus, LocationType } from "../../shared/schemas.js";
import type { SubscriptionPlan } from "../../shared/api/subscriptions.js";
import { HttpError } from "../pgErrors.js";
import { extractNotationTracksFromBytes, resolveAssignedTrackIndex } from "./notationService.js";
import { Sessions } from "./sessions.js";
import { Storage } from "./storage.js";
import { PgRootDB } from "../db.js";

export class Testing extends Context.Service<Testing>()("dfg-rocks/testing", {
  make: Effect.gen(function* () {
    const storage = yield* Storage;
    const sessions = yield* Sessions;
    const db = yield* PgRootDB;

    const queries = {
      userIdByUsername: (username: string) =>
        db.execute(db.selectFrom("app_public.users").select("id").where("username", "=", username)),

      createFamily: (values: { slug: string; name: string }) =>
        db.execute(
          db.insertInto("app_public.families").values(values).returning(["id", "slug", "name"]),
        ),

      familyIdBySlug: (slug: string) =>
        db.execute(db.selectFrom("app_public.families").select("id").where("slug", "=", slug)),

      addFamilyMembership: (values: {
        family_id: string;
        user_id: string;
        is_owner?: boolean;
        is_billing_contact?: boolean;
      }) =>
        db.execute(
          db
            .insertInto("app_public.family_memberships")
            .values(values)
            .onConflict((oc) => oc.doNothing()),
        ),
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
        role?: "admin" | "teacher" | "student" | "parent";
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
          const existingByEmail = yield* db
            .execute(
              db
                .selectFrom("app_public.user_emails")
                .innerJoin(
                  "app_public.users",
                  "app_public.users.id",
                  "app_public.user_emails.user_id",
                )
                .select("app_public.users.id")
                .where("app_public.user_emails.email", "=", email)
                .where("app_public.user_emails.is_verified", "=", true),
            )
            .pipe(Effect.head, Effect.option);

          if (Option.isSome(existingByEmail)) {
            userId = existingByEmail.value.id;
          } else {
            const created = yield* db
              .execute(
                db
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
                  .select("id"),
              )
              .pipe(Effect.head);
            userId = created.id;
          }
        }

        if (role !== "student") {
          yield* db.execute(
            db.updateTable("app_public.users").set({ role }).where("id", "=", userId),
          );
        }

        yield* db.execute(
          db
            .updateTable("app_private.user_secrets")
            .set({ password_hash: sql`crypt(${password}, gen_salt('bf'))` })
            .where("user_id", "=", userId),
        );

        const session = yield* sessions.createSession(userId);

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
        yield* db.execute(
          db
            .updateTable("app_private.user_secrets")
            .set({
              testimonial_prompt_enabled: values.promptEnabled,
              testimonial_next_prompt_at: values.nextPromptAt,
            })
            .where("user_id", "=", user.id),
        );
      }),

      seedSubmission: Effect.fnUntraced(function* (
        body: Readonly<{ name: string; email: string; spam_reason?: string }>,
      ) {
        yield* db.execute(
          db.insertInto("app_public.contact_submissions").values({
            name: body.name,
            email: body.email,
            instrument: "drums",
            format: "in-person",
            spam_reason: body.spam_reason ?? null,
          }),
        );
      }),

      clear: Effect.fnUntraced(function* () {
        // Seeded submissions use a test- email; the public form cannot create one.
        yield* db.execute(
          db.deleteFrom("app_public.contact_submissions").where("email", "like", "test-%"),
        );
        const testUsers = yield* db.execute(
          db.selectFrom("app_public.users").select("id").where("username", "like", "test_%"),
        );
        const testUserIds = testUsers.map((u) => u.id);

        // A test names its family freely ("parity-family"), so the slug prefix alone would leave
        // the family behind and the next seed-family would hit the unique slug.
        yield* db.execute(
          db.deleteFrom("app_public.families").where((eb) =>
            eb.or([
              eb("slug", "like", "test-%"),
              eb(
                "id",
                "in",
                eb
                  .selectFrom("app_public.family_memberships")
                  .select("family_id")
                  .where("user_id", "in", (qb) =>
                    qb
                      .selectFrom("app_public.users")
                      .select("id")
                      .where("username", "like", "test_%"),
                  ),
              ),
            ]),
          ),
        );

        const testMaterialFiles = yield* db.execute(
          db
            .selectFrom("app_public.materials")
            .select(["id", "storage_backend", "storage_key"])
            .where((eb) => {
              const conditions = [
                eb("storage_key", "like", "test/%"),
                eb("storage_key", "like", "/test/%"),
                eb("storage_key", "like", "/tmp/test-%"),
                eb("title", "like", "Test:%"),
                eb("original_filename", "in", [
                  "Scale-Patterns.pdf",
                  "Moonlight-Sonata.pdf",
                  "Fresh-Upload.pdf",
                ]),
                eb("title", "in", ["Scale Patterns", "Moonlight Sonata", "Fresh Upload"]),
              ];
              if (testUserIds.length > 0) {
                conditions.push(eb("uploaded_by", "in", testUserIds));
              }
              return eb.or(conditions);
            }),
        );

        if (testMaterialFiles.length > 0) {
          yield* db.execute(
            db.deleteFrom("app_public.materials").where(
              "id",
              "in",
              testMaterialFiles.map((m) => m.id),
            ),
          );
        }

        yield* db.execute(db.deleteFrom("app_public.users").where("username", "like", "test_%"));
        yield* db.execute(db.deleteFrom("app_public.courses").where("title", "like", "Test:%"));

        yield* Effect.forEach(
          testMaterialFiles.filter((material) => material.storage_backend === "local"),
          (material) =>
            storage
              .delete({
                storageBackend: material.storage_backend,
                storageKey: material.storage_key,
              })
              .pipe(Effect.ignore),
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
          .execute(
            db
              .insertInto("app_public.courses")
              .values({
                title: body.title,
                instrument: body.instrument,
                description: body.description ?? "",
              })
              .returning(["id", "title", "instrument", "description"]),
          )
          .pipe(Effect.head);

        const mods = body.modules ?? [];
        if (mods.length > 0) {
          yield* db.execute(
            db.insertInto("app_public.modules").values(
              mods.map((mod, index) => ({
                course_id: course.id,
                title: mod.title,
                sort_order: mod.sort_order ?? index + 1,
              })),
            ),
          );
        }

        return course.id;
      }),

      seedMaterial: Effect.fnUntraced(function* (body: {
        title: string;
        original_filename?: string;
        mime_type?: string;
        file_size?: number;
        visibility?: ContentVisibility;
        source_file_path?: string;
      }) {
        const originalFilename =
          body.original_filename ?? `${body.title.toLowerCase().replace(/\s+/g, "-")}.pdf`;
        const bytes = body.source_file_path
          ? new Uint8Array(yield* Effect.tryPromise(() => fs.readFile(body.source_file_path!)))
          : Buffer.from(
              `test-material:${body.title}:${originalFilename}:${crypto.randomUUID()}`,
              "utf8",
            );

        const storage = yield* Storage;
        const location = storage.testingLocation(originalFilename);
        yield* storage.put(location, bytes);

        const notationTracks = body.source_file_path
          ? yield* extractNotationTracksFromBytes(bytes, originalFilename)
          : null;

        const material = yield* db
          .execute(
            db
              .insertInto("app_public.materials")
              .values({
                title: body.title,
                original_filename: originalFilename,
                storage_backend: location.storageBackend,
                storage_key: location.storageKey,
                content_hash: null,
                mime_type: body.mime_type ?? "application/pdf",
                file_size: body.file_size ?? bytes.byteLength,
                visibility: body.visibility ?? "course",
                notation_tracks:
                  notationTracks === null ? null : sql`${JSON.stringify(notationTracks)}::jsonb`,
              })
              .returning(["id"]),
          )
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
          .execute(
            db
              .selectFrom("app_public.materials")
              .select(["id", "notation_tracks"])
              .where("title", "=", values.materialTitle),
          )
          .pipe(Effect.head);
        const assignedTrackIndex = yield* resolveAssignedTrackIndex(
          material.notation_tracks,
          values.assignedTrackIndex ? Number(values.assignedTrackIndex) : undefined,
        );

        yield* db.execute(
          db
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
            ),
        );
        return material.id;
      }),

      enroll: Effect.fnUntraced(function* (values: { username: string; courseTitle: string }) {
        const student = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        const course = yield* db
          .execute(
            db
              .selectFrom("app_public.courses")
              .select("id")
              .where("title", "=", values.courseTitle),
          )
          .pipe(Effect.head);

        yield* db.execute(
          db
            .insertInto("app_public.enrollments")
            .values({
              student_id: student.id,
              course_id: course.id,
            })
            .onConflict((oc) => oc.doNothing()),
        );
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

      seedSubscription: Effect.fnUntraced(function* (values: {
        username: string;
        plan: SubscriptionPlan;
        status: string;
        periodEndInDays: number;
        cancelAtPeriodEnd: boolean;
      }) {
        const user = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        const now = yield* Clock.currentTimeMillis;
        yield* db.execute(
          db.insertInto("app_public.subscriptions").values({
            payer_id: user.id,
            stripe_customer_id: `cus_e2e_${user.id}`,
            stripe_subscription_id: `sub_${crypto.randomUUID()}`,
            status: values.status,
            // The fake's price for the plan (server/services/stripeFake.ts).
            price_id: `price_e2e_${values.plan}`,
            plan: values.plan,
            current_period_end: new Date(now + values.periodEndInDays * 24 * 60 * 60 * 1000),
            cancel_at_period_end: values.cancelAtPeriodEnd,
            stripe_event_created: new Date(now),
          }),
        );
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
        invitedRole?: string;
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
            .execute(
              db
                .selectFrom("app_public.users")
                .select("id")
                .where((eb) => eb.or([eb("username", "=", "test_admin"), eb("role", "=", "admin")]))
                .orderBy(sql`case when username = 'test_admin' then 0 else 1 end`)
                .limit(1),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError({ status: 500, message: "No admin user found" }),
              }),
            );

          yield* queries.addFamilyMembership({
            family_id: familyId,
            user_id: admin.id,
            is_owner: true,
            is_billing_contact: false,
          });
        }

        const code = crypto.randomBytes(7).toString("hex");
        const invitation = yield* db
          .execute(
            db
              .insertInto("app_public.family_invitations")
              .values({
                family_id: familyId,
                email: values.email,
                code,
                invited_role: values.invitedRole ?? "parent",
                ...(values.expiresAt ? { expires_at: values.expiresAt } : {}),
              })
              .returning(["id"]),
          )
          .pipe(Effect.head);

        return { invitationId: invitation.id, code };
      }),

      seedDeleteAccount: Effect.fnUntraced(function* (username: string) {
        const user = yield* queries.userIdByUsername(username).pipe(Effect.head);
        const token = crypto.randomBytes(7).toString("hex");
        yield* db.execute(
          db
            .updateTable("app_private.user_secrets")
            .set({
              delete_account_token: token,
              delete_account_token_generated: new Date(),
            })
            .where("user_id", "=", user.id),
        );
        return token;
      }),

      /** The link the invitation email to this address carries, as the worker would build it. */
      invitationLink: Effect.fnUntraced(function* (email: string) {
        return yield* db
          .execute(
            db
              .selectFrom("app_public.family_invitations as invitation")
              .innerJoin(
                "app_public.user_emails as address",
                "address.user_id",
                "invitation.user_id",
              )
              .innerJoin(
                "app_private.user_email_secrets as secret",
                "secret.user_email_id",
                "address.id",
              )
              .select(["invitation.id", "secret.verification_token as token"])
              .where("invitation.family_id", "is", null)
              .where("address.email", "=", sql<string>`${email}::citext`)
              .where("secret.verification_token", "is not", null),
          )
          .pipe(
            Effect.head,
            Effect.map((row) => ({ id: row.id, token: row.token ?? "" })),
          );
      }),

      /** Moves the account invitation to this address one minute past its expiry. */
      expireInvitation: Effect.fnUntraced(function* (email: string) {
        yield* db.execute(
          db
            .updateTable("app_public.family_invitations")
            .set({ expires_at: sql<Date>`now() - interval '1 minute'` })
            .where("family_id", "is", null)
            .where("user_id", "in", (eb) =>
              eb
                .selectFrom("app_public.user_emails")
                .select("user_id")
                .where("email", "=", sql<string>`${email}::citext`),
            ),
        );
      }),

      seedLesson: Effect.fnUntraced(function* (values: {
        username: string;
        scheduledAt?: string | null;
        durationMinutes: number;
        locationType: LocationType;
        status: LessonStatus;
      }) {
        const student = yield* queries.userIdByUsername(values.username).pipe(Effect.head);
        yield* db.execute(
          db
            .insertInto("app_public.student_rates")
            .values({
              student_id: student.id,
              rate_cents: values.durationMinutes === 30 ? 5000 : 10000,
              lesson_duration_minutes: values.durationMinutes === 30 ? 30 : 60,
              location_type: values.locationType,
              billing_model: "single_booking",
            })
            .onConflict((conflict) =>
              conflict.columns(["student_id", "location_type"]).doNothing(),
            ),
        );
        yield* db.execute(
          db.insertInto("app_public.lessons").values({
            student_id: student.id,
            scheduled_at: new Date(
              values.scheduledAt ?? new Date(Date.now() + 86400000).toISOString(),
            ),
            duration_minutes: values.durationMinutes,
            location_type: values.locationType,
            status: values.status,
          }),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(Storage.layer, Sessions.layer, PgRootDB.layer)),
  );
}

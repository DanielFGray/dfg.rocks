import { Effect, Option, Context, Layer } from "effect";
import { type Database, PgRootDB } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";
import { TestimonialReminderService } from "./testimonialReminderService.js";
import { serializeTestimonial } from "../../shared/responseMappers.js";
import { type Testimonial } from "../../shared/schemas.js";

/** Testimonials: a user's own, the approved ones on the home page, and their approval. */
export class TestimonialService extends Context.Service<TestimonialService>()(
  "TestimonialService",
  {
    make: Effect.gen(function* () {
      const rootDb = yield* PgRootDB;
      return {
        testimonial: Effect.fn("testimonial")(function* (userId: string) {
          return yield* RequestDatabase.use((db) =>
            testimonialSelect(db, userId).pipe(
              Effect.head,
              Effect.option,
              Effect.map(Option.getOrNull),
            ),
          );
        }),
        upsertTestimonial: Effect.fn("upsertTestimonial")(function* (userId: string, body: string) {
          const row = yield* RequestDatabase.use(
            Effect.fnUntraced(function* (db) {
              yield* db.execute(
                db
                  .insertInto("app_public.testimonials")
                  .values({ body })
                  .onConflict((oc) =>
                    oc.column("user_id").doUpdateSet({
                      body,
                    }),
                  ),
              );
              return yield* testimonialSelect(db, userId).pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(500, "Failed to save testimonial"),
                }),
              );
            }),
          );
          yield* TestimonialReminderService.use((testimonialReminderService) =>
            testimonialReminderService.clearReminderState(userId),
          );
          return row;
        }),
        deleteTestimonial: Effect.fn("deleteTestimonial")(function* (userId: string) {
          yield* RequestDatabase.use(
            Effect.fnUntraced(function* (db) {
              return yield* db
                .execute(
                  db
                    .deleteFrom("app_public.testimonials")
                    .where("user_id", "=", userId)
                    .returning(["id"]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Testimonial not found"),
                  }),
                );
            }),
          );
          yield* TestimonialReminderService.use((testimonialReminderService) =>
            testimonialReminderService.scheduleNextReminder(userId),
          );
        }),
        listTestimonials: Effect.fn("listTestimonials")(function* () {
          return yield* RequestDatabase.use((db) =>
            db.execute(
              db
                .selectFrom("app_public.testimonials as t")
                .innerJoin("app_public.users as u", "u.id", "t.user_id")
                .select([
                  "t.id",
                  "t.user_id",
                  "t.body",
                  "t.is_approved",
                  "t.created_at",
                  "t.updated_at",
                  "u.username",
                  "u.name",
                  "u.role",
                ])
                .where("u.role", "!=", "admin")
                .orderBy("t.is_approved", "asc")
                .orderBy("t.updated_at", "desc"),
            ),
          );
        }),
        updateTestimonialApproval: Effect.fn("updateTestimonialApproval")(function* (
          testimonialId: string,
          isApproved: boolean,
        ) {
          return yield* RequestDatabase.use((db) =>
            db
              .execute(
                db
                  .with("updated", (qb) =>
                    qb
                      .updateTable("app_public.testimonials")
                      .set({ is_approved: isApproved })
                      .where("id", "=", testimonialId)
                      .returning(["id", "user_id", "is_approved"]),
                  )
                  .selectFrom("updated")
                  .innerJoin("app_public.users as u", "u.id", "updated.user_id")
                  .select(["updated.id", "updated.user_id", "updated.is_approved", "u.role"]),
              )
              .pipe(
                Effect.head,
                Effect.option,
                Effect.flatMap(
                  Option.match({
                    onNone: () => new HttpError(404, "Testimonial not found"),
                    onSome: Effect.succeed,
                  }),
                ),
              ),
          );
        }),
        homePageData: Effect.fn("homePageData")(function* () {
          const rows = yield* rootDb.execute(
            rootDb
              .selectFrom("app_public.testimonials as t")
              .innerJoin("app_public.users as u", "u.id", "t.user_id")
              .select([
                "t.id",
                "t.user_id",
                "t.body",
                "t.is_approved",
                "t.created_at",
                "t.updated_at",
                "u.username",
                "u.name",
                "u.role",
              ])
              .where("u.role", "!=", "admin")
              .where("t.is_approved", "=", true)
              .orderBy("t.updated_at", "desc")
              .limit(6),
          );

          return {
            testimonials: rows.map(serializeTestimonial),
          } satisfies HomePageData;
        }),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

function testimonialSelect(db: Database, userId: string) {
  return db.execute(
    db
      .selectFrom("app_public.testimonials as t")
      .innerJoin("app_public.users as u", "u.id", "t.user_id")
      .select([
        "t.id",
        "t.user_id",
        "t.body",
        "t.is_approved",
        "t.created_at",
        "t.updated_at",
        "u.username",
        "u.name",
        "u.role",
      ])
      .where("t.user_id", "=", userId)
      .limit(1),
  );
}

export interface HomePageData {
  readonly testimonials: readonly Testimonial[];
}

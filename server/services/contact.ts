import { Effect, Config, Context, Layer } from "effect";
import { addJob, PgRootDB } from "../db.js";

/** The site's contact form. */
export class Contact extends Context.Service<Contact>()("dfg-rocks/contact", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const adminEmail = yield* Config.NonEmptyString("ADMIN_EMAIL");
    return {
      submitContact: Effect.fn("submitContact")(function* (
        values: {
          name: string;
          email: string;
          phone?: string;
          instrument: string;
          format: string;
          message?: string;
        },
        geo?: {
          ip: string;
          country: string;
          region: string;
          city: string;
        },
      ) {
        // One transaction: the submission and its notification email exist together or not at all.
        yield* rootDb.withTransaction(
          Effect.gen(function* () {
            yield* rootDb.execute(
              rootDb.insertInto("app_public.contact_submissions").values({
                name: values.name,
                email: values.email,
                phone: values.phone ?? null,
                instrument: values.instrument,
                format: values.format,
                message: values.message ?? "",
                ip_address: geo?.ip ?? null,
                location_country: geo?.country || null,
                location_region: geo?.region || null,
                location_city: geo?.city || null,
              }),
            );
            yield* addJob(rootDb, "send_email", {
              options: {
                to: adminEmail,
                subject: `New contact: ${values.name} (${values.instrument})`,
              },
              template: "contact_submission.mjml",
              variables: {
                name: values.name,
                email: values.email,
                phone: values.phone ?? "",
                instrument: values.instrument,
                format: values.format,
                message: values.message ?? "",
              },
            });
          }),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgRootDB.layer));
}

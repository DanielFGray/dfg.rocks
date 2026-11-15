import { Effect, Config, Context, Layer, Option } from "effect";
import type { ContactPayload } from "../../shared/api/public.js";
import { addJob, PgRootDB } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { Geolocation, type GeoLocation } from "./geolocation.js";

/** The site's contact form. */
export class Contact extends Context.Service<Contact>()("dfg-rocks/contact", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const geolocation = yield* Geolocation;
    const adminEmail = yield* Config.NonEmptyString("ADMIN_EMAIL");
    return {
      /**
       * Saves a submission and queues its notification email. Refuses a filled honeypot field, and
       * a visitor located outside Texas. A visitor whose location is unknown (no address, or the
       * lookup failed) is accepted, so a lead is not lost while the lookup service is down.
       */
      submitContact: Effect.fn("submitContact")(function* (
        values: typeof ContactPayload.Type,
        ip: Option.Option<string>,
      ) {
        if (values.website) {
          return yield* new HttpError({ status: 400, message: "Invalid submission" });
        }
        const location = yield* Option.match(ip, {
          onNone: () => Effect.succeedNone,
          onSome: geolocation.lookupIp,
        });
        if (Option.exists(location, (found) => found.country !== "US" || found.region !== "TX")) {
          return yield* new HttpError({
            status: 403,
            message:
              "Sorry, I only accept lesson inquiries from the Houston / Galveston area in Texas. If you're outside Texas, I hope you find a great teacher near you!",
          });
        }
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
                ip_address: Option.getOrNull(ip),
                location_country: locationField(location, "country"),
                location_region: locationField(location, "region"),
                location_city: locationField(location, "city"),
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
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(PgRootDB.layer, Geolocation.layer)),
  );
}

/** One field of a found location; null when the location is unknown or the field is empty. */
const locationField = (
  location: Option.Option<GeoLocation>,
  field: "country" | "region" | "city",
) =>
  Option.getOrNull(
    Option.filter(
      Option.map(location, (found) => found[field]),
      (value) => value !== "",
    ),
  );

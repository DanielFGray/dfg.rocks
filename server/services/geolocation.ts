import { Context, Duration, Effect, Layer, Option, Schema as S } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
}

/** How long a lookup may take before the visitor's location counts as unknown. */
export const GeolocationTimeout = Context.Reference<Duration.Duration>(
  "dfg-rocks/geolocation/GeolocationTimeout",
  { defaultValue: () => Duration.seconds(3) },
);

// ip-api.com leaves out a field it has no value for: `message` on success, the location on failure.
const IpApiResponse = S.Struct({
  status: S.Literals(["success", "fail"]),
  message: S.optional(S.String),
  country: S.optional(S.String),
  countryCode: S.optional(S.String),
  region: S.optional(S.String),
  regionName: S.optional(S.String),
  city: S.optional(S.String),
  lat: S.optional(S.Finite),
  lon: S.optional(S.Finite),
});

export class Geolocation extends Context.Service<Geolocation>()("dfg-rocks/geolocation", {
  make: Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    return {
      /**
       * Where `ip` is, by ip-api.com. None when the service cannot say: it is down, slow, over its
       * quota, or has no record of the address. A caller treats none as "location unknown", not as
       * "outside the area".
       */
      lookupIp: Effect.fn("lookupIp")(function* (ip: string) {
        const timeout = yield* GeolocationTimeout;
        return yield* client
          .get(
            `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,lat,lon`,
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(IpApiResponse)),
            Effect.timeout(timeout),
            Effect.map(Option.liftPredicate((data) => data.status === "success")),
            Effect.map(
              Option.flatMap((data) =>
                Option.map(Option.fromNullishOr(data.countryCode), (country): GeoLocation => ({
                  country,
                  region: data.region ?? "",
                  city: data.city ?? "",
                  lat: data.lat ?? 0,
                  lon: data.lon ?? 0,
                })),
              ),
            ),
            Effect.catchTags({
              HttpClientError: (error) => unknownLocation(error.message),
              SchemaError: (error) => unknownLocation(error.message),
              TimeoutError: () => unknownLocation("timed out"),
            }),
          );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const unknownLocation = (reason: string) =>
  Effect.logWarning("IP geolocation unavailable", reason).pipe(
    Effect.as(Option.none<GeoLocation>()),
  );

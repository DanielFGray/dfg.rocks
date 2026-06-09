import { Effect, Schema as S } from "effect";
import * as HttpClient from "@effect/platform/HttpClient";

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
}

const IpApiResponse = S.Struct({
  status: S.Union(S.Literal("success"), S.Literal("fail")),
  message: S.NullishOr(S.String),
  country: S.NullishOr(S.String),
  countryCode: S.NullishOr(S.String),
  region: S.NullishOr(S.String),
  regionName: S.NullishOr(S.String),
  city: S.NullishOr(S.String),
  lat: S.NullishOr(S.Number),
  lon: S.NullishOr(S.Number),
});

export class GeolocationService extends Effect.Service<GeolocationService>()("GeolocationService", {
  accessors: true,
  succeed: {
    lookupIp: Effect.fnUntraced(function* (ip: string) {
      const res = yield* HttpClient.get(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,lat,lon`,
      );
      if (!res || res.status !== 200) return null;

      const data = yield* res.json.pipe(Effect.flatMap(S.decodeUnknown(IpApiResponse)));
      if (data.status !== "success") return null;

      const country = data.countryCode;
      if (!country) return null;

      return {
        country,
        region: data.region ?? "",
        city: data.city ?? "",
        lat: data.lat ?? 0,
        lon: data.lon ?? 0,
      } as GeoLocation;
    }),
  },
}) {}

import { Effect, Schema as S, Context, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
}

const IpApiResponse = S.Struct({
  status: S.Literals(["success", "fail"]),
  message: S.NullishOr(S.String),
  country: S.NullishOr(S.String),
  countryCode: S.NullishOr(S.String),
  region: S.NullishOr(S.String),
  regionName: S.NullishOr(S.String),
  city: S.NullishOr(S.String),
  lat: S.NullishOr(S.Finite),
  lon: S.NullishOr(S.Finite),
});

export class Geolocation extends Context.Service<Geolocation>()("dfg-rocks/geolocation", {
  make: Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return {
      lookupIp: Effect.fnUntraced(function* (ip: string) {
        const res = yield* client.get(
          `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,lat,lon`,
        );
        if (!res || res.status !== 200) return null;

        const data = yield* res.json.pipe(Effect.flatMap(S.decodeUnknownEffect(IpApiResponse)));
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
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

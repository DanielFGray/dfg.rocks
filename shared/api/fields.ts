/** Path and query fields that several feature contracts share. */
import { Schema as S } from "effect";

export function params<const Name extends string>(...names: readonly Name[]) {
  return S.Struct(
    Object.fromEntries(names.map((name) => [name, S.String])) as Record<Name, typeof S.String>,
  );
}

export const PaginationQuery = S.Struct({
  limit: S.optional(S.FiniteFromString),
  offset: S.optional(S.FiniteFromString),
});

export const BillingMonthQuery = S.Struct({ month: S.String });

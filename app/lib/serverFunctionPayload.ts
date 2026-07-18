// `@effect/sql-kysely` can return proxy-wrapped values that Seroval cannot
// encode. Call this only at createServerFn return boundaries, after values have
// already been normalized into their canonical response shapes.
export function toServerFunctionPayload<A>(value: A): A {
  return JSON.parse(JSON.stringify(value)) as A;
}

// Round-trips a value through JSON so Seroval receives plain data. Call this only
// at createServerFn return boundaries, after values have already been normalized
// into their canonical response shapes.
export function toServerFunctionPayload<A>(value: A): A {
  return JSON.parse(JSON.stringify(value)) as A;
}

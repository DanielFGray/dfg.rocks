import * as v from "valibot";
import { UserRole as UserRoleSchema, WorkingHours } from "./schemas.js";

export { UserRoleSchema, WorkingHours };

export const TokenSearch = v.object({
  token: v.optional(v.string()),
});

export type TokenSearch = v.InferOutput<typeof TokenSearch>;

export const InviteSearch = v.object({
  id: v.optional(v.string()),
  code: v.optional(v.string()),
});

export type InviteSearch = v.InferOutput<typeof InviteSearch>;

export const ApiError = v.object({
  error: v.string(),
  status: v.optional(v.number()),
});

export type ApiError = v.InferOutput<typeof ApiError>;

export function parseWith<TOutput>(
  schema: v.BaseSchema<unknown, TOutput, v.BaseIssue<unknown>>,
  value: unknown,
): TOutput {
  return v.parse(schema, value);
}

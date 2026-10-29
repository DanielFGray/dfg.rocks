import * as S from "effect/Schema";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requiredValidator = {
  onChange: S.toStandardSchemaV1(S.String.pipe(S.check(S.isMinLength(1, { message: "Required" })))),
};

export const usernameValidator = {
  onChange: S.toStandardSchemaV1(
    S.String.pipe(S.check(S.isMinLength(3, { message: "Must be at least 3 characters" }))),
  ),
};

export const emailValidator = {
  onChange: S.toStandardSchemaV1(
    S.String.pipe(
      S.check(S.isMinLength(1, { message: "Required" })),
      S.check(S.isPattern(emailPattern, { message: "Invalid email" })),
    ),
  ),
};

export const passwordValidator = {
  onChange: S.toStandardSchemaV1(
    S.String.pipe(S.check(S.isMinLength(6, { message: "Must be at least 6 characters" }))),
  ),
};

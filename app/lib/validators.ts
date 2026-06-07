import * as S from "effect/Schema";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requiredValidator = {
  onChange: S.standardSchemaV1(
    S.String.pipe(S.minLength(1, { message: () => "Required" })),
  ),
};

export const usernameValidator = {
  onChange: S.standardSchemaV1(
    S.String.pipe(
      S.minLength(3, { message: () => "Must be at least 3 characters" }),
    ),
  ),
};

export const emailValidator = {
  onChange: S.standardSchemaV1(
    S.String.pipe(
      S.minLength(1, { message: () => "Required" }),
      S.pattern(emailPattern, { message: () => "Invalid email" }),
    ),
  ),
};

export const passwordValidator = {
  onChange: S.standardSchemaV1(
    S.String.pipe(
      S.minLength(6, { message: () => "Must be at least 6 characters" }),
    ),
  ),
};

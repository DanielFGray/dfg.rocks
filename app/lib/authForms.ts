import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { Schema as S } from "effect";
import { getErrorMessage } from "./errors.js";
import { callApi } from "./inProcessCall.js";
import { normalizeLoginRedirect } from "./loginRedirect.js";

/*
 * The forms on the auth pages post here before hydration. Each handler calls its API endpoint
 * in process (callApi), so the endpoint's rate limit runs and the endpoint sets the session
 * cookie. A refusal returns to the form's page with the endpoint's message.
 */

function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value;
  }
  return obj;
}

function validateFormData<A>(schema: S.ConstraintDecoder<A>, formData: FormData): A {
  return S.decodeSync(schema)(formDataToObject(formData));
}

const PasswordLoginSchema = S.Struct({
  id: S.String.pipe(S.check(S.isNonEmpty())),
  password: S.String.pipe(S.check(S.isNonEmpty())),
  redirect: S.optional(S.String),
});

export const loginWithPassword = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return validateFormData(PasswordLoginSchema, data);
  })
  .handler(async ({ data }) => {
    await callApi((api) =>
      api.auth.login({ payload: { id: data.id, password: data.password } }),
    ).catch((error) => {
      throw redirect({
        to: "/login",
        search: { redirect: data.redirect, error: getErrorMessage(error, "Login failed") },
      });
    });
    throw redirect({ to: normalizeLoginRedirect(data.redirect) ?? "/dashboard" });
  });

const MagicLinkSchema = S.Struct({
  email: S.String.pipe(S.check(S.isNonEmpty())),
  redirect: S.optional(S.String),
});

export const requestMagicLink = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return validateFormData(MagicLinkSchema, data);
  })
  .handler(async ({ data }) => {
    await callApi((api) => api.auth.magicLink({ payload: { email: data.email } })).catch(
      (error) => {
        throw redirect({
          to: "/login",
          search: {
            redirect: data.redirect,
            login_method: "magic",
            error: getErrorMessage(error, "Could not send the link"),
          },
        });
      },
    );
    throw redirect({
      to: "/login",
      search: { magic_sent: true as const, redirect: data.redirect, login_method: "magic" },
    });
  });

const ForgotPasswordSchema = S.Struct({
  email: S.String.pipe(S.check(S.isNonEmpty())),
});

export const forgotPassword = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return validateFormData(ForgotPasswordSchema, data);
  })
  .handler(async ({ data }) => {
    await callApi((api) => api.auth.forgotPassword({ payload: { email: data.email } })).catch(
      (error) => {
        throw redirect({
          to: "/forgot-password",
          search: { error: getErrorMessage(error, "Could not send the reset link") },
        });
      },
    );
    throw redirect({ to: "/forgot-password", search: { sent: true as const } });
  });

const ResetPasswordSchema = S.Struct({
  token: S.String.pipe(S.check(S.isNonEmpty())),
  password: S.String.pipe(S.check(S.isMinLength(6))),
});

export const resetPassword = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return validateFormData(ResetPasswordSchema, data);
  })
  .handler(async ({ data }) => {
    await callApi((api) =>
      api.auth.resetPassword({ payload: { token: data.token, password: data.password } }),
    ).catch((error) => {
      throw redirect({
        to: "/reset-password",
        search: { token: data.token, error: getErrorMessage(error, "Password reset failed") },
      });
    });
    throw redirect({ to: "/dashboard" });
  });

const AcceptInviteSchema = S.Struct({
  id: S.String.pipe(S.check(S.isNonEmpty())),
  code: S.optional(S.String),
  name: S.String.pipe(S.check(S.isNonEmpty())),
  username: S.String.pipe(S.check(S.isMinLength(3))),
  email: S.optional(S.String),
  password: S.String.pipe(S.check(S.isMinLength(6))),
});

export const acceptInvitation = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return validateFormData(AcceptInviteSchema, data);
  })
  .handler(async ({ data }) => {
    await callApi((api) =>
      api.public.acceptInvitation({
        params: { id: data.id },
        payload: {
          code: data.code,
          username: data.username,
          password: data.password,
          name: data.name,
          email: data.email,
        },
      }),
    ).catch((error) => {
      throw redirect({
        to: "/accept-invite",
        search: {
          id: data.id,
          code: data.code,
          error: getErrorMessage(error, "Could not accept invitation"),
        },
      });
    });
    throw redirect({ to: "/dashboard" });
  });

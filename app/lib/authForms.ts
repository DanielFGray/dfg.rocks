import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { Effect, Schema as S } from "effect";
import { runServerEffect } from "./serverEffect.js";
import { Auth } from "../../server/services/auth.js";
import { Families } from "../../server/services/families.js";
import { Users } from "../../server/services/users.js";
import { normalizeLoginRedirect } from "./loginRedirect.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

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
    const result = await runServerEffect(
      Effect.gen(function* () {
        const login = yield* Auth.use((authService) =>
          authService.login({ id: data.id, password: data.password }),
        );
        yield* Users.use((userService) => userService.primaryEmailForUser(login.user.user_id));
        return {
          token: login.token,
          expiresAt: login.expiresAt,
          redirectTo: normalizeLoginRedirect(data.redirect) ?? "/dashboard",
        };
      }),
    ).catch((error) => {
      const message = messageFromError(error, "Login failed");
      throw redirect({
        to: "/login",
        search: {
          ...(data.redirect ? { redirect: data.redirect } : {}),
          error: message,
        },
      });
    });
    setCookie("session", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
      expires: result.expiresAt,
    });
    throw redirect({ to: result.redirectTo });
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
    await runServerEffect(Auth.use((authService) => authService.generateMagicLink(data.email)));
    throw redirect({
      to: "/login",
      search: {
        magic_sent: true as const,
        redirect: data.redirect,
        login_method: "magic",
      },
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
    await runServerEffect(
      Auth.use((authService) => authService.forgotPassword({ email: data.email })),
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
    const result = await runServerEffect(
      Auth.use((authService) =>
        authService.resetPassword({
          token: data.token,
          password: data.password,
        }),
      ),
    ).catch((error) => {
      throw redirect({
        to: "/reset-password",
        search: {
          token: data.token,
          error: messageFromError(error, "Password reset failed"),
        },
      });
    });
    setCookie("session", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
      expires: result.expiresAt,
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
    const session = await runServerEffect(
      Families.use((familyService) =>
        familyService.acceptInvitation({
          invitationId: data.id,
          code: data.code,
          username: data.username,
          password: data.password,
          name: data.name,
          email: data.email,
        }),
      ),
    ).catch((err) => {
      throw redirect({
        to: "/accept-invite",
        search: {
          id: data.id,
          code: data.code,
          error: messageFromError(err, "Could not accept invitation"),
        },
      });
    });
    setCookie("session", session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS / 1000,
      path: "/",
      expires: session.expiresAt,
    });
    throw redirect({ to: "/dashboard" });
  });

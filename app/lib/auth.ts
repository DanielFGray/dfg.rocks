import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { sessionService } from "../../server/services/sessionService.js";
import { rootDb } from "../../server/db.js";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
};

export const getAuthUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ user: AuthUser | null }> => {
    const token = getCookie("session");
    if (!token) return { user: null };

    const session = await sessionService.validateSessionToken(token);
    if (!session) return { user: null };

    const profile = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "name", "role", "is_verified"])
      .select((eb) =>
        eb
          .selectFrom("app_public.user_emails")
          .select("email")
          .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .where("id", "=", session.user.id)
      .executeTakeFirst();

    if (!profile) return { user: null };

    return {
      user: {
        id: profile.id,
        username: profile.username,
        name: profile.name ?? "",
        email: profile.email ?? "",
        role: profile.role,
        is_verified: profile.is_verified,
      },
    };
  },
);

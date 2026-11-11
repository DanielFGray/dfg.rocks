import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { runServerEffect } from "./serverEffect.js";
import { AuthRouteService } from "../../server/services/authRouteService.js";
import type { MeResponse } from "../../shared/api/auth.js";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
};

export type AuthState = MeResponse;

function toPlainAuthState(state: AuthState): AuthState {
  const plainUser = (user: NonNullable<AuthState["user"]>) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    is_verified: user.is_verified,
  });
  return {
    user: state.user ? plainUser(state.user) : null,
    isParent: state.isParent,
    familyStudents: state.familyStudents.map(plainUser),
    activeStudentId: state.activeStudentId,
    activeStudent: state.activeStudent
      ? {
          id: state.activeStudent.id,
          username: state.activeStudent.username,
          name: state.activeStudent.name,
        }
      : null,
  };
}

export const getAuthUser = createServerFn({ method: "GET" }).handler(async () => {
  const state = await runServerEffect(
    AuthRouteService.use((authRouteService) => authRouteService.currentUser(getCookie("session"))),
  );
  return JSON.stringify(toPlainAuthState(state));
});

export function decodeAuthState(state: string): AuthState {
  return JSON.parse(state) as AuthState;
}

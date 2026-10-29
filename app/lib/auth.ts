import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { serverRuntime } from "../../server/runtime.js";
import { AuthRouteService } from "../../server/services/authRouteService.js";
import { SessionService } from "../../server/services/sessionService.js";
import type { MeResponse } from "../../shared/httpApi.js";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
};

export type AuthState = MeResponse;

const anonymousAuthState = (): AuthState => ({
  user: null,
  isParent: false,
  familyStudents: [],
  activeStudentId: null,
  activeStudent: null,
});

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
  const token = getCookie("session");
  if (!token) return JSON.stringify(anonymousAuthState());

  const session = await serverRuntime.runPromise(
    SessionService.use((sessionService) => sessionService.validateSessionToken(token)),
  );
  if (!session) return JSON.stringify(anonymousAuthState());

  const state = await serverRuntime.runPromise(
    AuthRouteService.use((authRouteService) =>
      authRouteService.me(session.session.id, session.user.id, session.session.active_student_id),
    ),
  );
  return JSON.stringify(toPlainAuthState(state));
});

export function decodeAuthState(state: string): AuthState {
  return JSON.parse(state) as AuthState;
}

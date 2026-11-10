import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "./auth.js";

const parentState: AuthState = {
  user: {
    id: "u1",
    username: "parent",
    name: "Parent",
    email: "parent@example.com",
    role: "parent",
    is_verified: true,
  },
  isParent: true,
  familyStudents: [],
  activeStudentId: "s1",
  activeStudent: { id: "s1", username: "kid", name: "Kid" },
};

// getAuthUser is a server function that answers with JSON text.
const getAuthUser = vi.fn(async () => JSON.stringify(parentState));
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getAuthUser: () => getAuthUser(),
}));

const { fetchAuthUser, getEffectiveStudentId } = await import("./queries.js");

describe("auth query cache", () => {
  beforeEach(() => getAuthUser.mockClear());

  it("gives the route guard the decoded state on every navigation, not only the first", async () => {
    const queryClient = new QueryClient();

    const first = await fetchAuthUser(queryClient);
    const second = await fetchAuthUser(queryClient);

    expect(first.user?.id).toBe("u1");
    expect(second.user?.id).toBe("u1");
    expect(getAuthUser).toHaveBeenCalledTimes(1);
  });

  it("reads a parent's active student from the cached state", async () => {
    const queryClient = new QueryClient();
    await fetchAuthUser(queryClient);

    expect(getEffectiveStudentId(queryClient)).toBe("s1");
  });
});

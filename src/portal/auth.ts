import { Atom } from "fibrae";
import type { User } from "./api.js";

/** Current authenticated user, populated after login or /api/me check */
export const currentUser = Atom.make<User | null>(null);

/** Shared email input across login, magic link, and forgot password forms */
export const emailValue = Atom.make("");

/** Derive admin status from currentUser */
export const isAdmin = (user: User | null): boolean =>
  user?.role === "admin";

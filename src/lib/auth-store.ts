/**
 * Auth store — backed entirely by backend session cookies. No browser storage.
 *
 *  - User accounts:  /api/account/{signup,login,logout,me,check-email}
 *  - Admin auth:     /api/auth/{login,logout,me,credentials}
 *
 * Identity is the email address (Gmail-style).
 */
import { api, ApiError } from "./api-client";

export interface AccountUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  createdAt: string;
  avatarColor: string;
}

interface ApiUser {
  id: string;
  username: string;
  email: string;
  avatar_color: string;
  full_name?: string;
  created_at: string;
}
function fromApi(u: ApiUser): AccountUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.full_name || "",
    avatarColor: u.avatar_color,
    createdAt: u.created_at,
  };
}

const EVT = "hdpornforyou:auth-changed";
export const AUTH_EVENT = EVT;

let userCache: AccountUser | null = null;
let adminCache: string | null = null;
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

async function rehydrateUserStores() {
  if (typeof window === "undefined") return;
  try {
    const [{ hydrateSubscriptions }, { hydrateSaved }] = await Promise.all([
      import("./subscriptions-store"),
      import("./saved-store"),
    ]);
    await Promise.allSettled([hydrateSubscriptions(), hydrateSaved()]);
  } catch {
    /* ignore */
  }
}

export async function hydrateAuth(): Promise<void> {
  const [u, a] = await Promise.all([
    api.get<{ user: ApiUser | null }>("/api/account/me").catch(() => ({ user: null })),
    api.get<{ admin: string | null }>("/api/auth/me").catch(() => ({ admin: null })),
  ]);
  userCache = u.user ? fromApi(u.user) : null;
  adminCache = a.admin ?? null;
  hydrated = true;
  emit();
}

export function currentUser(): AccountUser | null {
  if (!hydrated && typeof window !== "undefined") hydrateAuth().catch(() => {});
  return userCache;
}

export function isAdmin(): boolean {
  if (!hydrated && typeof window !== "undefined") hydrateAuth().catch(() => {});
  return adminCache !== null;
}

export function authHydrated(): boolean {
  return hydrated;
}

export function getAdminUsername(): string {
  return adminCache ?? "admin";
}

/* ---------- user account ---------- */

/**
 * Gmail-style email pre-check: returns `true` if an account with this email
 * already exists. Used by the signup form to mirror Google's "already have
 * an account?" flow.
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const r = await api.get<{ exists: boolean; valid: boolean }>(
      `/api/account/check-email?email=${encodeURIComponent(email)}`,
    );
    return !!r.exists;
  } catch {
    return false;
  }
}

export async function signup(
  fullName: string,
  email: string,
  password: string,
): Promise<{ ok: true; user: AccountUser } | { ok: false; error: string }> {
  try {
    const { user } = await api.post<{ user: ApiUser }>("/api/account/signup", {
      fullName,
      email,
      password,
    });
    userCache = fromApi(user);
    emit();
    await rehydrateUserStores();
    return { ok: true, user: userCache };
  } catch (e) {
    return { ok: false, error: (e as ApiError).message };
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true; user: AccountUser } | { ok: false; error: string }> {
  try {
    const { user } = await api.post<{ user: ApiUser }>("/api/account/login", {
      email,
      password,
    });
    userCache = fromApi(user);
    emit();
    await rehydrateUserStores();
    return { ok: true, user: userCache };
  } catch (e) {
    return { ok: false, error: (e as ApiError).message };
  }
}

export async function logout(): Promise<void> {
  await api.post("/api/account/logout").catch(() => {});
  userCache = null;
  emit();
  await rehydrateUserStores();
}

export async function updateFullName(
  fullName: string,
): Promise<{ ok: true; user: AccountUser } | { ok: false; error: string }> {
  try {
    const { user } = await api.patch<{ user: ApiUser }>("/api/account/me", { fullName });
    userCache = fromApi(user);
    emit();
    return { ok: true, user: userCache };
  } catch (e) {
    return { ok: false, error: (e as ApiError).message };
  }
}

/* ---------- admin ---------- */

export async function adminLogin(username: string, password: string): Promise<boolean> {
  try {
    await api.post("/api/auth/login", { username, password });
    adminCache = username;
    emit();
    return true;
  } catch {
    return false;
  }
}

export async function adminLogout(): Promise<void> {
  await api.post("/api/auth/logout").catch(() => {});
  adminCache = null;
  emit();
}

export async function updateAdminCredentials(
  currentPassword: string,
  newUsername: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { username } = await api.post<{ username: string }>("/api/auth/credentials", {
      currentPassword,
      newUsername,
      newPassword,
    });
    adminCache = username;
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as ApiError).message };
  }
}

/* ---------- setup wizard ---------- */

export async function getSetupStatus(): Promise<{ needsSetup: boolean }> {
  return api.get<{ needsSetup: boolean }>("/api/setup/status");
}

export async function initializeSetup(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api.post("/api/setup/initialize", { username, password });
    adminCache = username;
    emit();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as ApiError).message };
  }
}

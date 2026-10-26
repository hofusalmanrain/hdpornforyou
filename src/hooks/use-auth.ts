import { useEffect, useState } from "react";
import { AUTH_EVENT, authHydrated, currentUser, isAdmin, type AccountUser } from "@/lib/auth-store";

export function useAuth(): { user: AccountUser | null; admin: boolean; ready: boolean } {
  const [state, setState] = useState(() => ({
    user: currentUser(),
    admin: isAdmin(),
    ready: authHydrated(),
  }));
  useEffect(() => {
    const sync = () => setState({ user: currentUser(), admin: isAdmin(), ready: authHydrated() });
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return state;
}

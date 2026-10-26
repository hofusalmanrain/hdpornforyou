import { useEffect, useState } from "react";
import { applyTheme, getTheme, THEME_EVENT, type ThemeConfig } from "@/lib/theme-store";

/** Apply persisted theme on mount and subscribe to updates. */
export function useThemeBootstrap() {
  useEffect(() => {
    applyTheme();
    const sync = () => applyTheme();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
}

export function useTheme(): ThemeConfig {
  const [t, setT] = useState(() => getTheme());
  useEffect(() => {
    const sync = () => setT(getTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);
  return t;
}

import { useEffect, useState } from "react";
import { getBrandLogoUrl, BRAND_LOGO_EVENT, hydrateBrandLogo } from "@/lib/brand-logo-store";

/** Reactive subscription to the brand logo store. */
export function useBrandLogo(): string | null {
  const [url, setUrl] = useState<string | null>(() => getBrandLogoUrl());
  useEffect(() => {
    const sync = () => setUrl(getBrandLogoUrl());
    sync();
    window.addEventListener(BRAND_LOGO_EVENT, sync);
    hydrateBrandLogo().catch(() => {});
    return () => window.removeEventListener(BRAND_LOGO_EVENT, sync);
  }, []);
  return url;
}

/**
 * Hydrate every store from the backend at app startup.
 * Called once from __root.tsx; safe to call again (idempotent).
 */
import { hydrateAuth } from "./auth-store";
import { hydrateVideos } from "./video-store";
import { hydrateLabels } from "./labels-store";
import { hydrateTheme } from "./theme-store";
import { hydrateSeo } from "./seo-store";
import { hydrateAds } from "./ads-config";
import { hydrateComments } from "./comments-store";
import { hydrateSubscriptions } from "./subscriptions-store";
import { hydrateSaved } from "./saved-store";
import { hydrateCategories } from "./categories-store";
import { hydrateBrandLogo } from "./brand-logo-store";
import { hydrateGeoCountry } from "./geo";

let started = false;

export function bootstrapStores() {
  if (started || typeof window === "undefined") return;
  started = true;
  // Fire all in parallel; individual stores swallow their own errors.
  Promise.allSettled([
    hydrateAuth(),
    hydrateVideos(),
    hydrateLabels(),
    hydrateTheme(),
    hydrateSeo(),
    hydrateGeoCountry().then(hydrateAds),
    hydrateComments(),
    hydrateSubscriptions(),
    hydrateSaved(),
    hydrateCategories(),
    hydrateBrandLogo(),
  ]);
}

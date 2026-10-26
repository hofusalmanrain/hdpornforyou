/**
 * Shared GEO tier detection used by both ad-router and VAST tag routing.
 * Extracted to avoid circular dependencies between ads-config ↔ ad-router.
 */

const TIER1 = new Set([
  "US",
  "CA",
  "GB",
  "UK",
  "AU",
  "NZ",
  "IE",
  "DE",
  "NL",
  "FR",
  "BE",
  "AT",
  "CH",
  "SE",
  "NO",
  "DK",
  "FI",
  "IT",
  "ES",
  "PT",
  "LU",
]);

const TIER1_TZ_PREFIXES = [
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Halifax",
  "America/St_Johns",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Vienna",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Helsinki",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Europe/Rome",
  "Europe/Luxembourg",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Pacific/Auckland",
];

let cachedTier: "tier1" | "tier23" | null = null;
let cachedCountry: string | null = null;
let countryLookupStarted = false;

export function detectGeoTier(): "tier1" | "tier23" {
  if (cachedTier) return cachedTier;
  if (typeof window === "undefined") return "tier23";
  try {
    const w = window as unknown as { __EMBED_COUNTRY__?: string };
    if (w.__EMBED_COUNTRY__) {
      cachedCountry = w.__EMBED_COUNTRY__.toUpperCase();
      cachedTier = TIER1.has(cachedCountry) ? "tier1" : "tier23";
      return cachedTier;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (TIER1_TZ_PREFIXES.some((p) => tz === p || tz.startsWith(p + "/"))) {
      cachedTier = "tier1";
    } else {
      cachedTier = "tier23";
    }
  } catch {
    cachedTier = "tier23";
  }
  return cachedTier;
}

/**
 * Hydrate the country once from a trusted CDN/reverse-proxy header exposed by
 * the same-origin server. Timezone detection remains the immediate fallback.
 */
export async function hydrateGeoCountry(): Promise<void> {
  if (countryLookupStarted || typeof window === "undefined") return;
  countryLookupStarted = true;
  try {
    const response = await fetch("/api/geo", { credentials: "same-origin" });
    if (!response.ok) return;
    const data = (await response.json()) as { country?: unknown };
    if (typeof data.country !== "string" || !/^[A-Za-z]{2}$/.test(data.country)) return;
    cachedCountry = data.country.toUpperCase();
    cachedTier = TIER1.has(cachedCountry) ? "tier1" : "tier23";
    (window as unknown as { __EMBED_COUNTRY__?: string }).__EMBED_COUNTRY__ = cachedCountry;
    window.dispatchEvent(new Event("hdpornforyou:ads-changed"));
    // Consent rule depends on the country — re-evaluate ad gating now that
    // the trusted header is known (unlocks non-EEA visitors pre-decision).
    void import("./ads-config")
      .then((m) => m.notifyConsentContextChanged())
      .catch(() => {});
  } catch {
    // Browser timezone fallback remains active.
  }
}

export function resetGeoCache() {
  cachedTier = null;
  cachedCountry = null;
  countryLookupStarted = false;
}

export function getDetectedCountry(): string | null {
  return cachedCountry;
}

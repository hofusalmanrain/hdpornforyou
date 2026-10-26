import { useEffect } from "react";
import { getSeo, SEO_EVENT } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";

/**
 * Returns true if the route owns its own SEO (title, canonical, OG etc)
 * and SeoApplier must NOT overwrite those tags. Covers all routes that
 * implement per-page SEO via useEffect / StaticPage.
 */
export function isPerPageSeoRoute(pathname: string): boolean {
  const p = pathname.split("?")[0].split("#")[0];
  const norm = p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  if (norm === "/" || norm === "/explore" || norm === "/trending" || norm === "/latest" || norm === "/search") return true;
  if (norm.startsWith("/watch/") || norm === "/watch") return true;
  if (norm.startsWith("/category/")) return true;
  if (norm.startsWith("/tags/")) return true;
  if (norm === "/account" || norm === "/setup") return true;
  // Static pages that use <StaticPage> (own title/canonical/OG)
  const staticExact = new Set(["/about", "/contact", "/privacy", "/terms", "/dmca", "/2257", "/careers", "/press"]);
  if (staticExact.has(norm)) return true;
  return false;
}

/**
 * Applies global SEO settings to the document head at runtime,
 * including OG / Twitter card metadata and custom <head>/<body> injection.
 */
export function SeoApplier() {
  useEffect(() => {
    const upsertMeta = (attr: "name" | "property", key: string, content: string | undefined) => {
      if (!content) return;
      const selector = `meta[${attr}="${key}"]`;
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    const apply = () => {
      const seo = getSeo();
      const pathname = typeof window !== "undefined" ? window.location.pathname : "";
      const isWatchPage = pathname.startsWith("/watch");
      const isPerPage = isPerPageSeoRoute(pathname);
      // Fallback detection: if a canonical is already present and matches current path,
      // the page has claimed ownership of its SEO (covers future routes).
      const hasOwnedCanonical = (() => {
        if (typeof document === "undefined") return false;
        const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (!link || !link.href) return false;
        try {
          const u = new URL(link.href);
          return u.pathname === pathname || u.pathname.startsWith(pathname);
        } catch {
          return false;
        }
      })();

      const shouldSkipPerPage = isWatchPage || isPerPage || hasOwnedCanonical;

      // Avoid clobbering per-page SEO (title, OG, Twitter, canonical) which is
      // managed by the route itself (StaticPage, index, explore, trending,
      // latest, category, tags, watch, search). SeoApplier runs globally and
      // would otherwise race and overwrite the page-specific tags after navigation.
      if (!shouldSkipPerPage) {
        if (seo.title) document.title = seo.title;
        upsertMeta("name", "description", seo.description);
        upsertMeta("name", "robots", seo.robots);

        upsertMeta("property", "og:title", seo.title);
        upsertMeta("property", "og:description", seo.description);
        upsertMeta("property", "og:type", seo.og.type);
        upsertMeta("property", "og:site_name", seo.og.siteName);
        upsertMeta("property", "og:image", seo.og.image);
        if (seo.og.image) {
          upsertMeta("property", "og:image:width", "1200");
          upsertMeta("property", "og:image:height", "630");
          upsertMeta("property", "og:image:type", "image/jpeg");
        }
        upsertMeta("property", "og:image:alt", seo.og.imageAlt);

        upsertMeta("name", "twitter:card", seo.twitter.card);
        upsertMeta("name", "twitter:site", seo.twitter.site);
        upsertMeta("name", "twitter:creator", seo.twitter.creator);
        upsertMeta("name", "twitter:title", seo.title);
        upsertMeta("name", "twitter:description", seo.description);
        upsertMeta("name", "twitter:image", seo.twitter.image || seo.og.image);
      } else {
        // On per-page routes only apply safe global fallbacks that don't conflict
        // with page-owned metadata (robots may still be useful if the
        // page hasn't set them).
        // Don't overwrite robots if page already set specific value (e.g. noindex for 404/empty)
        const hasRobots = !!document.head.querySelector('meta[name="robots"]');
        if (!hasRobots) upsertMeta("name", "robots", seo.robots);
        // Always ensure twitter:site/creator and og:site_name are present even on per-page routes
        if (!document.head.querySelector('meta[name="twitter:site"]')) upsertMeta("name", "twitter:site", seo.twitter.site);
        if (!document.head.querySelector('meta[name="twitter:creator"]')) upsertMeta("name", "twitter:creator", seo.twitter.creator);
        if (!document.head.querySelector('meta[property="og:site_name"]')) upsertMeta("property", "og:site_name", seo.og.siteName);
      }

      // Ensure og:image fallback exists (1200x630) when no per-page image is present — public/og-image.jpg
      if (!document.head.querySelector('meta[property="og:image"]')?.getAttribute("content")) {
        const fallbackImg = seo.og.image || "https://hdpornforyou.com/og-image.jpg";
        if (fallbackImg) {
          upsertMeta("property", "og:image", fallbackImg);
          upsertMeta("property", "og:image:width", "1200");
          upsertMeta("property", "og:image:height", "630");
          upsertMeta("property", "og:image:type", "image/jpeg");
          if (!document.head.querySelector('meta[name="twitter:image"]')?.getAttribute("content")) {
            upsertMeta("name", "twitter:image", seo.twitter.image || fallbackImg);
          }
        }
      }

      // Ensure og:image dimensions are present wherever og:image exists (P1: lighthouse requires width/height/type)
      const ogImgEl = document.head.querySelector('meta[property="og:image"]');
      if (ogImgEl && ogImgEl.getAttribute("content")) {
        if (!document.head.querySelector('meta[property="og:image:width"]')) upsertMeta("property", "og:image:width", "1200");
        if (!document.head.querySelector('meta[property="og:image:height"]')) upsertMeta("property", "og:image:height", "630");
        if (!document.head.querySelector('meta[property="og:image:type"]')) upsertMeta("property", "og:image:type", "image/jpeg");
      }

      // Global Organization + WebSite JSON-LD with SearchAction (present on all pages)
      (() => {
        const origin = (seo.canonicalBase && seo.canonicalBase.trim() ? seo.canonicalBase.trim().replace(/\/$/, "") : window.location.origin);
        const brand = seo.og.siteName || "HDPORNFORYOU";
        // Resolve logo: prefer brand-logo URL if available, else fallback to og-image.jpg (never 404 /logo.png)
        let logoUrl = "";
        try {
          const cachedLogo = (window as unknown as { __BRAND_LOGO_URL__?: string }).__BRAND_LOGO_URL__;
          logoUrl = absoluteUrl(origin, cachedLogo || seo.og.image || "/og-image.jpg");
        } catch {}
        if (!logoUrl) logoUrl = `${origin}/og-image.jpg`;
        const orgId = "ld-organization";
        const siteId = "ld-website";
        removeJsonLdByTypes(["Organization", "WebSite"]);
        const orgScript = document.createElement("script");
        orgScript.id = orgId;
        orgScript.type = "application/ld+json";
        orgScript.textContent = JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: brand,
          url: `${origin}/`,
          logo: logoUrl,
        });
        document.head.appendChild(orgScript);
        const siteScript = document.createElement("script");
        siteScript.id = siteId;
        siteScript.type = "application/ld+json";
        siteScript.textContent = JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: brand,
          url: `${origin}/`,
          potentialAction: {
            "@type": "SearchAction",
            target: `${origin}/search?q={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        });
        document.head.appendChild(siteScript);
      })();

      /* ----- Custom head/body code injection ----- */
      const HEAD_ID = "hdpornforyou-custom-head";
      const BODY_ID = "hdpornforyou-custom-body";
      document.getElementById(HEAD_ID)?.remove();
      document.getElementById(BODY_ID)?.remove();

      if (seo.customHead) {
        const tpl = document.createElement("template");
        tpl.innerHTML = seo.customHead.trim();
        const container = document.createElement("div");
        container.id = HEAD_ID;
        container.appendChild(tpl.content.cloneNode(true));
        document.head.appendChild(container);
      }
      if (seo.customBody) {
        const tpl = document.createElement("template");
        tpl.innerHTML = seo.customBody.trim();
        const container = document.createElement("div");
        container.id = BODY_ID;
        container.appendChild(tpl.content.cloneNode(true));
        document.body.appendChild(container);
      }
    };

    apply();
    window.addEventListener(SEO_EVENT, apply);
    // Observe per-page og:image injections and auto-add dimensions (covers watch, category, tags, etc. without touching each route)
    const ogObserver = new MutationObserver(() => {
      const el = document.head.querySelector('meta[property="og:image"]');
      if (el && el.getAttribute("content")) {
        if (!document.head.querySelector('meta[property="og:image:width"]')) upsertMeta("property", "og:image:width", "1200");
        if (!document.head.querySelector('meta[property="og:image:height"]')) upsertMeta("property", "og:image:height", "630");
        if (!document.head.querySelector('meta[property="og:image:type"]')) upsertMeta("property", "og:image:type", "image/jpeg");
      }
    });
    try {
      ogObserver.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
    } catch {}
    return () => {
      window.removeEventListener(SEO_EVENT, apply);
      try { ogObserver.disconnect(); } catch {}
    };
  }, []);

  return null;
}

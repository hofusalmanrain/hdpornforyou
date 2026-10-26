import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Routes, Route, useLocation, useNavigate, useNavigationType } from "react-router";
import { resetEngagement } from "@/lib/ad-router";
import { beacon } from "@/lib/api-client";
import { readScrollSnapshot, saveScrollPosition, scrollKey } from "@/lib/scroll-memory";
import { Toaster } from "@/components/ui/sonner";

function FaviconApplier() {
  useLayoutEffect(() => {
    let cancelled = false;
    const DEFAULT_ICONS: Array<[string, string, string]> = [
      ["icon", "/favicon.ico", "app-favicon"],
      ["icon", "/favicon.svg", "app-favicon-svg"],
      ["icon", "/favicon-96x96.png", "app-favicon-96"],
    ];
    const apply = (url: string | null) => {
      if (cancelled) return;
      if (url) {
        let link = document.querySelector<HTMLLinkElement>('#app-favicon, link[rel="icon"]');
        if (!link) {
          link = document.createElement("link");
          link.rel = "icon";
          link.id = "app-favicon";
          document.head.appendChild(link);
        }
        link.href = url;
        document
          .querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
          .forEach((l) => {
            if (l !== link) l.remove();
          });
      } else {
        for (const [rel, href, id] of DEFAULT_ICONS) {
          let link = document.getElementById(id) as HTMLLinkElement | null;
          if (!link) {
            link = document.createElement("link");
            link.rel = rel;
            link.id = id;
            document.head.appendChild(link);
          }
          link.href = href;
        }
      }
    };
    fetch("/api/favicon")
      .then((r) => r.json())
      .then(({ url }) => {
        if (!url) return apply(null);
        apply(url);
      })
      .catch(() => apply(null));
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

if (typeof window !== "undefined") {
  // Take over scroll restoration from the browser.
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  // Save scroll position continuously (throttled via rAF).
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        saveScrollPosition();
        ticking = false;
      });
    },
    { passive: true },
  );
}

function ScrollToTop() {
  const { pathname, search } = useLocation();
  const navType = useNavigationType();
  const previousPathRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    let cleanupRestore: (() => void) | undefined;
    const restoreScroll = (top: number, height = 0) => {
      let cancelled = false;
      let frame = 0;
      const startedAt = performance.now();
      const target = Math.max(0, top);
      const previousMinHeight = document.body.style.minHeight;
      if (height > window.innerHeight) {
        document.body.style.minHeight = `${height}px`;
      }
      // Content can hydrate after route mount, so retry briefly until the
      // saved offset exists. Keep this short so Back feels instant.
      const RETRY_WINDOW_MS = 1200;
      let ro: ResizeObserver | null = null;
      const cancel = () => {
        cancelled = true;
        document.body.style.minHeight = previousMinHeight;
        if (frame) cancelAnimationFrame(frame);
        if (ro) {
          ro.disconnect();
          ro = null;
        }
        window.removeEventListener("wheel", cancel, true);
        window.removeEventListener("touchstart", cancel, true);
        window.removeEventListener("keydown", cancel, true);
      };
      const tick = () => {
        if (cancelled) return;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const nextTop = Math.min(target, maxScroll);
        window.scrollTo({ top: nextTop, left: 0, behavior: "auto" });

        const reached =
          maxScroll >= target
            ? Math.abs(window.scrollY - target) <= 2
            : Math.abs(window.scrollY - maxScroll) <= 2;
        if ((!reached || maxScroll < target) && performance.now() - startedAt < RETRY_WINDOW_MS) {
          frame = requestAnimationFrame(tick);
        } else if (target === 0) {
          // Instant top-jumps don't need the observer to keep firing.
          cancel();
        }
      };
      window.addEventListener("wheel", cancel, { capture: true, passive: true });
      window.addEventListener("touchstart", cancel, { capture: true, passive: true });
      window.addEventListener("keydown", cancel, true);
      // When the document grows (images/related videos load), re-attempt
      // reaching the saved offset until the retry window closes.
      if (target > 0 && typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => {
          if (cancelled) return;
          if (performance.now() - startedAt >= RETRY_WINDOW_MS) {
            cancel();
            return;
          }
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(tick);
        });
        ro.observe(document.documentElement);
      }
      frame = requestAnimationFrame(tick);
      return cancel;
    };

    const key = scrollKey(pathname, search);
    const previousPath = previousPathRef.current;
    if (navType === "POP") {
      // Back navigation (browser back / mobile gesture) — always restore the
      // exact saved scroll position for the URL we're returning to. This
      // matches native browser behavior across every page, including
      // watch → watch back-navigation (return to the up-next card that was
      // clicked, not the top of the previous watch page).
      void previousPath; // kept for future diagnostics
      const saved = readScrollSnapshot(key);
      cleanupRestore = restoreScroll(saved?.top ?? 0, saved?.height ?? 0);
    } else {
      // Push/Replace navigation: jump to the top.
      cleanupRestore = restoreScroll(0);
    }
    beacon("/api/analytics/pageview", { path: pathname });
    previousPathRef.current = pathname;
    return () => {
      saveScrollPosition(key, window.scrollY);
      cleanupRestore?.();
    };
  }, [pathname, search, navType]);
  return null;
}

import { AdProvider } from "@/components/site/AdProvider";
import { RouteProgress } from "@/components/site/RouteProgress";
import { SeoApplier } from "@/components/site/SeoApplier";
import { BackToTop } from "@/components/site/BackToTop";
import { VideoSlider } from "@/components/site/VideoSlider";
import { StickyAd } from "@/components/site/StickyAd";
import { InterstitialController } from "@/components/site/InterstitialController";
import { PopunderController } from "@/components/site/PopunderController";
import { PushController } from "@/components/site/PushController";
import { CookieConsent } from "@/components/site/CookieConsent";
import { AgeVerification } from "@/components/site/AgeVerification";
import { useThemeBootstrap } from "@/hooks/use-theme";
import { bootstrapStores } from "@/lib/store-bootstrap";
import { getSetupStatus } from "@/lib/auth-store";

import Index from "@/routes/index";
const About = lazy(() => import("@/routes/about"));
const Account = lazy(() => import("@/routes/account"));
const Admin = lazy(() => import("@/routes/admin"));
const Careers = lazy(() => import("@/routes/careers"));
const CategorySlug = lazy(() => import("@/routes/category.$slug"));
const Contact = lazy(() => import("@/routes/contact"));
const Dmca = lazy(() => import("@/routes/dmca"));
const Explore = lazy(() => import("@/routes/explore"));
const Latest = lazy(() => import("@/routes/latest"));
const Press = lazy(() => import("@/routes/press"));
const Privacy = lazy(() => import("@/routes/privacy"));
const Search = lazy(() => import("@/routes/search"));
const Setup = lazy(() => import("@/routes/setup"));
const Terms = lazy(() => import("@/routes/terms"));
const Trending = lazy(() => import("@/routes/trending"));
const WatchSlug = lazy(() => import("@/routes/watch.$slug"));
const TwoTwoFiveSeven = lazy(() => import("@/routes/2257"));
const NotFound = lazy(() => import("@/routes/not-found"));
const TagsPage = lazy(() => import("@/routes/tags.$tag"));

function SetupGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetupStatus()
      .then((r) => {
        if (cancelled) return;
        if (r.needsSetup && loc.pathname !== "/setup") {
          navigate("/setup", { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecked(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) return null;
  return <>{children}</>;
}

/**
 * Catch-all route. When the URL doesn't match any registered route, check
 * with the server whether the first path segment matches the (private) admin
 * prefix. If yes → render the Admin panel. Otherwise → 404.
 *
 * This keeps the admin prefix server-side only (never exposed via /api/config)
 * and removes the first-load delay caused by fetching it on every page load.
 */
function AdminOrNotFound() {
  const { pathname } = useLocation();
  const [state, setState] = useState<"checking" | "admin" | "notfound">("checking");

  useEffect(() => {
    let cancelled = false;
    const segs = pathname.split("/").filter(Boolean);
    // Only single-segment URLs can be the admin prefix.
    if (segs.length !== 1) {
      setState("notfound");
      return;
    }
    fetch("/api/admin/check-prefix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: segs[0] }),
    })
      .then((r) => (r.ok ? r.json() : { match: false }))
      .then((d) => {
        if (!cancelled) setState(d.match ? "admin" : "notfound");
      })
      .catch(() => {
        if (!cancelled) setState("notfound");
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (state === "checking") return null;
  if (state === "admin") return <Admin />;
  return <NotFound />;
}

export default function App() {
  useThemeBootstrap();
  const { pathname } = useLocation();

  useEffect(() => {
    bootstrapStores();
  }, []);

  useEffect(() => {
    resetEngagement();
  }, [pathname]);

  return (
    <>
      <Toaster position="top-center" richColors closeButton />
      <FaviconApplier />
      <SeoApplier />
      <AdProvider />
      <ScrollToTop />
      <RouteProgress />
      <BackToTop />
      <VideoSlider />
      <StickyAd />
      <InterstitialController />
      <PopunderController />
      <PushController />
      <AgeVerification />
      <CookieConsent />

      <SetupGate>
        <Suspense fallback={<div className="min-h-screen bg-background" />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/about" element={<About />} />
            <Route path="/account" element={<Account />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/category/:slug" element={<CategorySlug />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/dmca" element={<Dmca />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/latest" element={<Latest />} />
            <Route path="/press" element={<Press />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/search" element={<Search />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/trending" element={<Trending />} />
            <Route path="/watch/:embedId/:slug" element={<WatchSlug />} />
            <Route path="/watch/:slug" element={<WatchSlug />} />
            <Route path="/tags/:tag" element={<TagsPage />} />
            <Route path="/2257" element={<TwoTwoFiveSeven />} />
            <Route path="*" element={<AdminOrNotFound />} />
          </Routes>
        </Suspense>
      </SetupGate>
    </>
  );
}

import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ThumbsUp, ThumbsDown, Share2, Bookmark, Eye } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Player } from "@/components/site/Player";
import { VideoCard } from "@/components/site/VideoCard";
import { MobileNav } from "@/components/site/MobileNav";
import { AdSlot } from "@/components/site/AdSlot";
import { Comments } from "@/components/site/Comments";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { Fragment } from "react";
import { useReactions } from "@/hooks/use-reactions";
import { react, trackView } from "@/lib/reactions-store";
import { toast } from "sonner";
import { epornerUrl, formatViews, getEmbedId, normalizeEpornerUrl, relatedTo, slugify, type Video } from "@/data/videos";
import { useVideos, useVideosReady } from "@/hooks/use-videos";
import { useLabels } from "@/hooks/use-labels";
import { useEffect, useMemo, useState } from "react";
import { isSubscribed, toggleSubscription, SUBS_EVENT } from "@/lib/subscriptions-store";
import { isSaved, toggleSaved, SAVED_EVENT } from "@/lib/saved-store";
import { saveScrollPosition } from "@/lib/scroll-memory";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";

const watchVideoCache = new Map<string, Video>();

export default function WatchPage() {
  const { embedId = "", slug = "" } = useParams<{ embedId?: string; slug: string }>();
  const all = useVideos();
  const videosReady = useVideosReady();
  const labels = useLabels();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const routeStateVideo = (location.state as { video?: Video } | null)?.video;

  // Resolve the video from the live catalog. Prefer matching by embedId from
  // the URL when present; fall back to slug/id lookup.
  const video: Video | undefined = useMemo(() => {
    if (embedId) {
      const fromLive = all.find((v) => getEmbedId(v) === embedId);
      if (fromLive) return fromLive;
      if (routeStateVideo && getEmbedId(routeStateVideo) === embedId) return routeStateVideo;
      const cached = watchVideoCache.get(embedId);
      if (cached) return cached;
    }
    const key = slug;
    return (
      all.find((v) => v.slug === key || v.id === key) ??
      (routeStateVideo && (routeStateVideo.slug === key || routeStateVideo.id === key)
        ? routeStateVideo
        : undefined) ??
      watchVideoCache.get(key) ??
      undefined
    );
  }, [all, embedId, routeStateVideo, slug]);

  useEffect(() => {
    if (!video) return;
    watchVideoCache.set(getEmbedId(video), video);
    if (video.slug) watchVideoCache.set(video.slug, video);
    watchVideoCache.set(video.id, video);
  }, [video]);

  // NOTE: We intentionally do NOT canonicalize /watch/:slug → /watch/:embedId/:slug
  // here. Doing that fires a `navigate(..., { replace: true })` which switches
  // the matched <Route> element (the two paths are separate Route entries),
  // causing WatchPage to unmount and remount. That remount re-triggered the
  // `animate-fade-up` entrance animation on the Player card — the exact
  // flicker users saw after clicking a video from Account → Saved videos.
  // The legacy single-segment URL is still fully functional; callers already
  // link with `watchPathFor()` (canonical form) everywhere new.

  const related = useMemo(() => (video ? relatedTo(video, all, 8) : []), [video, all]);

  const videoId = video?.id ?? "";
  const { counts, reaction } = useReactions(videoId, user?.id ?? null);

  useEffect(() => {
    if (videoId) trackView(videoId);
  }, [videoId]);

  // helper: convert duration "12:34" or "1:02:03" to ISO8601 "PT12M34S"
  const toISO8601Duration = (d: string): string => {
    if (!d || d === "LIVE") return "PT0S";
    const parts = d.split(":").map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return "PT0S";
    let h = 0, m = 0, s = 0;
    if (parts.length === 3) [h, m, s] = parts;
    else if (parts.length === 2) [m, s] = parts;
    else if (parts.length === 1) s = parts[0];
    let out = "PT";
    if (h) out += `${h}H`;
    if (m) out += `${m}M`;
    if (s || (!h && !m)) out += `${s}S`;
    return out;
  };

  // SEO: dynamic title, meta description, canonical, OG and VideoObject + BreadcrumbList JSON-LD
  useEffect(() => {
    if (!video) return;
    const title = `${video.title} - Watch ${video.category} Porn in HD | ${labels.brandName}`;
    document.title = title;
    const desc = (video.description || "").slice(0, 155).replace(/\s+/g, " ").trim() || `${video.title} - ${video.category} porn video embedded via Eporner.`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = desc;
    // Use helper to upsert
    const upsert = (attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    const seo = getSeo();
    const canonicalBase = seo.canonicalBase?.trim().replace(/\/$/, "") || window.location.origin;
    const canonicalUrl = `${canonicalBase}/watch/${getEmbedId(video)}/${video.slug || video.id}`;
    const ogImg = video.thumbnail || absoluteUrl(canonicalBase, seo.og.image || "/og-image.jpg");
    const ogWidth = video.thumbnail ? "640" : "1200";
    const ogHeight = video.thumbnail ? "360" : "630";
    upsert("property", "og:title", title);
    upsert("property", "og:description", desc);
    upsert("property", "og:type", "video.other");
    upsert("property", "og:image", ogImg);
    upsert("property", "og:image:width", ogWidth);
    upsert("property", "og:image:height", ogHeight);
    upsert("property", "og:image:type", "image/jpeg");
    upsert("property", "og:image:alt", video.title);
    upsert("property", "og:url", canonicalUrl);
    upsert("property", "og:site_name", seo.og.siteName || labels.brandName);
    upsert("name", "robots", "index,follow");
    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", desc);
    upsert("name", "twitter:image", ogImg);
    // Canonical
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonicalUrl;
    // JSON-LD VideoObject - uploadDate validated to ISO8601 with isNaN check
    removeJsonLdByTypes(["VideoObject", "BreadcrumbList"]);
    const ldId = "watch-video-ld";
    document.getElementById(ldId)?.remove();
    const script = document.createElement("script");
    script.id = ldId;
    script.type = "application/ld+json";
    const _rawUploadDate = new Date(video.uploadedAt);
    const isoUploadDate = isNaN(_rawUploadDate.getTime()) ? new Date().toISOString() : _rawUploadDate.toISOString();
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: video.title,
      description: desc,
      thumbnailUrl: [video.thumbnail],
      uploadDate: isoUploadDate,
      duration: toISO8601Duration(video.duration),
      embedUrl: video.embedUrl,
      contentUrl: normalizeEpornerUrl(video.sourceUrl || epornerUrl(getEmbedId(video), video.slug || video.title)),
      genre: video.category,
      keywords: (video.tags || []).join(", "),
      interactionStatistic: {
        "@type": "InteractionCounter",
        interactionType: { "@type": "WatchAction" },
        userInteractionCount: video.views,
      },
      isFamilyFriendly: false,
      isAccessibleForFree: true,
    });
    document.head.appendChild(script);
    // JSON-LD BreadcrumbList
    const bcId = "watch-breadcrumb-ld";
    document.getElementById(bcId)?.remove();
    const bcScript = document.createElement("script");
    bcScript.id = bcId;
    bcScript.type = "application/ld+json";
    bcScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${canonicalBase}/` },
        { "@type": "ListItem", position: 2, name: video.category, item: `${canonicalBase}/category/${video.category}` },
        { "@type": "ListItem", position: 3, name: video.title, item: canonicalUrl },
      ],
    });
    document.head.appendChild(bcScript);
    return () => {
      document.getElementById(ldId)?.remove();
      document.getElementById(bcId)?.remove();
      // OG cleanup: remove OG/twitter that are page-specific so next page doesn't leak stale values
      // We keep description/title as they will be overwritten, but ensure og:type reset is handled by SeoApplier
    };
  }, [video, labels.brandName]);

  // SPA 404 for watch: when video is not found after catalog is ready,
  // mark as noindex,follow and remove canonical so crawlers don't index
  // soft-404 watch URLs (mirrors not-found.tsx behavior).
  useEffect(() => {
    if (video || !videosReady) return;
    const prevTitle = document.title;
    document.title = `Video Not Found | ${labels.brandName}`;
    let el = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "robots");
      document.head.appendChild(el);
    }
    const prev = el.content;
    el.content = "noindex,follow";
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = link?.href || "";
    if (link) link.remove();
    return () => {
      document.title = prevTitle;
      const cur = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (cur) cur.content = prev || "index,follow";
      if (prevHref) {
        // let next route recreate canonical; don't restore stale
      }
    };
  }, [video, videosReady, labels.brandName]);

  // Scroll behavior on watch-page navigation is fully handled by the
  // App-level <ScrollToTop /> in src/App.tsx: PUSH (upnext click) restores
  // to 0, POP (browser back) restores the previously saved scroll for the
  // target watch URL. A local scroll-to-top effect here would fight the
  // POP restoration (breaking back-press from /account → /watch/X) and
  // cause enough layout thrash to swallow the fade-up entrance animation
  // on the new video's cards, so it is intentionally omitted.

  // Subscription state for this video's channel.
  const channel = video?.channel ?? "";
  const [subscribed, setSubscribed] = useState<boolean>(() => isSubscribed(channel));
  useEffect(() => {
    const sync = () => setSubscribed(isSubscribed(channel));
    sync();
    window.addEventListener(SUBS_EVENT, sync);
    return () => window.removeEventListener(SUBS_EVENT, sync);
  }, [channel]);

  const handleSubscribe = async () => {
    if (!user) {
      toast.info("Please sign in to subscribe.");
      navigate("/account");
      return;
    }
    if (!channel) return;
    try {
      const isNow = await toggleSubscription(channel);
      toast.success(isNow ? `Subscribed to ${channel}` : `Unsubscribed from ${channel}`);
    } catch {
      toast.error("Could not update subscription.");
    }
  };

  const [showFullDesc, setShowFullDesc] = useState(false);
  const [saved, setSaved] = useState<boolean>(() => isSaved(videoId));
  useEffect(() => {
    const sync = () => setSaved(isSaved(videoId));
    sync();
    window.addEventListener(SAVED_EVENT, sync);
    return () => window.removeEventListener(SAVED_EVENT, sync);
  }, [videoId]);

  const handleSave = async () => {
    if (!user) {
      toast.info("Please sign in to save videos.");
      navigate("/account");
      return;
    }
    try {
      const now = await toggleSaved(videoId);
      toast.success(now ? "Saved to your library" : "Removed from saved");
    } catch {
      toast.error("Could not update saved list.");
    }
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const shareData = { title: video?.title || "Watch this", text: video?.title, url };

    // Detect a true mobile/touch device. Desktop Chrome technically exposes
    // navigator.share, but it routinely fails ("Permission denied" / "Share
    // canceled" without a user gesture target) and falls into the empty
    // catch — leaving the desktop user with no feedback at all. So on
    // desktop we go straight to the clipboard path.
    const isMobile =
      /Android|iPhone|iPad|iPod|Mobile|Opera Mini/i.test(navigator.userAgent) ||
      (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);

    const copyFallback = async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Last-resort clipboard for non-secure contexts / older browsers.
          const ta = document.createElement("textarea");
          ta.value = url;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        toast.success("Link copied to clipboard");
      } catch {
        // Surface the URL if even clipboard fails so the user can copy manually.
        toast.message("Copy this link", { description: url });
      }
    };

    if (isMobile && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        // AbortError = user cancelled the sheet; don't fall through to copy.
        if ((err as DOMException)?.name === "AbortError") return;
        // Any other failure → fall through to clipboard.
      }
    }
    await copyFallback();
  };

  const handleReact = (kind: "like" | "dislike") => {
    if (!user) {
      toast.info("Please sign in to react.");
      navigate("/account");
      return;
    }
    react(user.id, videoId, kind);
  };

  if (!video && !videosReady) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 text-center px-4">
          <h1 className="font-display text-3xl">Loading Video…</h1>
          <p className="text-muted-foreground mt-2">Refreshing the embedded catalog from the server.</p>
        </div>
        <MobileNav />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 text-center px-4">
          <h1 className="font-display text-3xl">Video Not Found</h1>
          <p className="text-muted-foreground mt-2">This embedded video may have been removed from Eporner or deleted from our index.</p>
          <Link to="/" className="text-primary underline mt-4 inline-block">
            Back to Home
          </Link>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8">
        <div key={videoId} className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-up">
          <div className="lg:col-span-2">
            {/* Above-player ads (admin-controlled, per-device targeted) */}
            {(() => {
              const nb = getAds().nativeBanner;
              const show =
                nb.watchAboveEnabled &&
                (isMobile ? (nb.watchAboveMobile ?? true) : (nb.watchAboveDesktop ?? true));
              return show ? (
                <div className="mb-4 empty:hidden">
                  <AdSlot placement="watchAbove" format="banner" label="Sponsored" />
                </div>
              ) : null;
            })()}
            {(() => {
              const o = getAds().outstream;
              const show =
                o.aboveVideoPlayer &&
                (isMobile ? (o.aboveMobile ?? true) : (o.aboveDesktop ?? true));
              return show ? (
                <div className="mb-4">
                  <OutstreamAd placement="watchAboveOutstream" framed fillParent />
                </div>
              ) : null;
            })()}
            {(() => {
              const nb = getAds().nativeBanner;
              const show =
                nb.watchAboveNativeEnabled &&
                (isMobile
                  ? (nb.watchAboveNativeMobile ?? true)
                  : (nb.watchAboveNativeDesktop ?? true));
              return show ? (
                <div className="mb-4">
                  <AdSlot placement="watchNativeFeed" format="native" label="Native sponsored" />
                </div>
              ) : null;
            })()}

            <Player video={video} />

            <p className="mt-2 text-xs text-muted-foreground text-center">
              Source:{" "}
              <a
                href={normalizeEpornerUrl(
                  video.sourceUrl ||
                    epornerUrl(getEmbedId(video), video.slug || video.title),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Eporner.com
              </a>{" "}
              • Embedded • 18+ •{" "}
              <a href="/dmca" className="underline">
                Report
              </a>
            </p>

            <h1 className="mt-4 font-display text-2xl md:text-3xl font-bold leading-tight">
              {video.title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Eye className="h-4 w-4" /> {formatViews(video.views)} views
              </span>
              <span>•</span>
              <span>{new Date(video.uploadedAt).toLocaleDateString()}</span>
              <span>•</span>
              <Link
                to={`/category/${video.category}`}
                onPointerDown={() => saveScrollPosition()}
                onClick={() => saveScrollPosition()}
                className="uppercase tracking-wider text-primary hover:underline"
              >
                {video.category}
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
              <ActionBtn
                icon={<ThumbsUp className="h-4 w-4" />}
                label={formatViews(video.likes || 0)}
                primary={reaction === "like"}
                onClick={() => handleReact("like")}
              />
              <ActionBtn
                icon={<ThumbsDown className="h-4 w-4" />}
                label={counts.dislikes > 0 ? formatViews(counts.dislikes) : "Dislike"}
                primary={reaction === "dislike"}
                onClick={() => handleReact("dislike")}
              />
              <ActionBtn
                icon={<Share2 className="h-4 w-4" />}
                label="Share"
                onClick={handleShare}
              />
              <ActionBtn
                icon={<Bookmark className="h-4 w-4" />}
                label={saved ? "Saved" : "Save"}
                primary={saved}
                onClick={handleSave}
              />
            </div>

            <div className="mt-6 rounded-2xl gradient-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-full gradient-primary flex items-center justify-center font-display font-bold text-primary-foreground">
                  {video.channel.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{video.channel}</p>
                  <p className="text-xs text-muted-foreground">Embedded • 18+</p>
                </div>
                <button
                  onClick={handleSubscribe}
                  aria-pressed={subscribed}
                  className={[
                    "ml-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:scale-105",
                    subscribed
                      ? "bg-secondary text-foreground border border-border"
                      : "gradient-primary text-primary-foreground shadow-glow",
                  ].join(" ")}
                >
                  {subscribed ? "Subscribed" : labels.subscribeLabel}
                </button>
              </div>

              {/* Description card below the channel name */}
              {video.description && (
                <div className="mt-4 rounded-xl bg-background/40 p-4 text-sm leading-relaxed">
                  <p
                    className={
                      showFullDesc ? "whitespace-pre-wrap" : "whitespace-pre-wrap line-clamp-3"
                    }
                  >
                    {video.description}
                  </p>
                  {!showFullDesc && (
                    <button
                      onClick={() => setShowFullDesc(true)}
                      className="mt-2 text-xs font-semibold text-primary hover:underline"
                    >
                      Show more
                    </button>
                  )}
                  {showFullDesc && (
                    <button
                      onClick={() => setShowFullDesc(false)}
                      className="mt-2 text-xs font-semibold text-primary hover:underline"
                    >
                      Show less
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {(video.tags?.length ? video.tags : [video.category]).map((t: string) => (
                    <button
                      key={t}
                      onPointerDown={() => saveScrollPosition()}
                      onClick={() => {
                        saveScrollPosition();
                        navigate(`/tags/${slugify(t)}`);
                      }}
                      className="rounded-full bg-secondary/60 px-3 py-1 text-xs text-muted-foreground hover:bg-primary/20 hover:text-primary transition-all"
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {!video.tags?.length && (
                  <p className="text-xs text-muted-foreground mt-2">AI tags not yet generated — showing category. Enable AI enrichment in Admin → Automation / Importer to generate tags.</p>
                )}
              </div>
            </div>

            {/* Below-player ads (admin-controlled, rendered BELOW the channel card). */}
            {(() => {
              const nb = getAds().nativeBanner;
              const show =
                nb.watchBelowEnabled &&
                (isMobile ? (nb.watchBelowMobile ?? true) : (nb.watchBelowDesktop ?? true));
              return show ? (
                <div className="mt-6 empty:hidden">
                  <AdSlot placement="watchUnder" format="banner" label="Sponsored" />
                </div>
              ) : null;
            })()}
            {(() => {
              const o = getAds().outstream;
              const show =
                o.belowVideoPlayer &&
                (isMobile ? (o.belowMobile ?? true) : (o.belowDesktop ?? true));
              return show ? (
                <div className="mt-6">
                  <OutstreamAd placement="watchBelowOutstream" framed fillParent />
                </div>
              ) : null;
            })()}
            {(() => {
              const nb = getAds().nativeBanner;
              const show =
                nb.watchBelowNativeEnabled &&
                (isMobile
                  ? (nb.watchBelowNativeMobile ?? true)
                  : (nb.watchBelowNativeDesktop ?? true));
              return show ? (
                <div className="mt-6">
                  <AdSlot placement="watchNativeFeed" format="native" label="Native sponsored" />
                </div>
              ) : null;
            })()}

            <div className="mt-8">
              <h2 className="font-display text-xl font-bold mb-4">{labels.commentsTitle}</h2>
              <Comments videoId={video.id} />
            </div>
          </div>

          <aside className="space-y-4">
            {/* Ad slot first, clearly separated — never rendered under a
                content heading like "Coming Up" (network policy: ads must be
                distinguishable from editorial content). */}
            {(() => {
              const ads = getAds();
              const outstream = ads.outstream;
              const nativeBanner = ads.nativeBanner;
              const showOutstreamSidebar =
                outstream.sidebarEnabled !== false &&
                (isMobile ? outstream.sidebarMobile !== false : outstream.sidebarDesktop !== false);
              const showSidebarBanner =
                !!nativeBanner.sidebarBannerEnabled &&
                (isMobile
                  ? (nativeBanner.sidebarBannerMobile ?? true)
                  : (nativeBanner.sidebarBannerDesktop ?? true));
              const showSidebarNative =
                nativeBanner.sidebarNativeEnabled !== false &&
                (isMobile
                  ? (nativeBanner.sidebarNativeMobile ?? true)
                  : (nativeBanner.sidebarNativeDesktop ?? true));

              if (showOutstreamSidebar) {
                return (
                  <OutstreamAd
                    placement="watchSidebarOutstream"
                    className="mb-4"
                    framed
                    fillParent
                    sidebar
                  />
                );
              }
              if (showSidebarBanner) {
                return (
                  <AdSlot
                    placement="watchSidebarBanner"
                    format="banner"
                    className="mb-4"
                    label="Sponsored"
                    sidebar
                  />
                );
              }
              return showSidebarNative ? (
                <AdSlot
                  placement="watchSidebar"
                  format="sidebar"
                  className="mb-4"
                  label="Sponsored"
                  sidebar
                />
              ) : null;
            })()}
            {related.map((v, i) => {
              const ads = getAds();
              const every = Math.max(2, ads.intervals.relatedNativeEvery || 6);
              const slot = pickFeedSlot(i, every, "related");
              const showNative = slot === "native";
              const showOutstream = slot === "outstream";
              const showBanner = slot === "banner";
              return (
                <Fragment key={v.id}>
                  <VideoCard video={v} size="compact" />
                  {showNative && (
                    <AdSlot placement="relatedNative" format="native" label="Sponsored" />
                  )}
                  {showOutstream && <OutstreamAd placement="relatedOutstream" framed fillParent />}
                  {showBanner && (
                    <AdSlot placement="relatedFeedBanner" format="banner" label="Sponsored" />
                  )}
                </Fragment>
              );
            })}
          </aside>
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all whitespace-nowrap min-w-0",
        primary
          ? "gradient-primary text-primary-foreground shadow-glow hover:scale-105"
          : "glass hover:bg-secondary",
      ].join(" ")}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

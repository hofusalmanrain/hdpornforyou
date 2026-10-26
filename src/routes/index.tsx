import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigationType, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/site/Hero";
import { Row } from "@/components/site/Row";
import { CategoryChips } from "@/components/site/CategoryChips";
import { VideoCard } from "@/components/site/VideoCard";
import { AdSlot } from "@/components/site/AdSlot";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { MobileNav } from "@/components/site/MobileNav";
import { useVideos } from "@/hooks/use-videos";
import { useLabels } from "@/hooks/use-labels";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";
import { watchPathFor } from "@/data/videos";

const PAGE_SIZE = 22;

function getPaginationRange(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range: (number | string)[] = [];
  range.push(1);
  if (current > 3) range.push("ellipsis-start");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) range.push(i);
  if (current < total - 2) range.push("ellipsis-end");
  range.push(total);
  // dedupe ellipsis if needed and ensure no duplicates
  return range;
}

export default function Index() {
  const all = useVideos();
  const labels = useLabels();
  const navType = useNavigationType();
  const [searchParams] = useSearchParams();
  const [category, setCategory] = useState("all");
  const [showDeferred, setShowDeferred] = useState(() => navType === "POP");

  // SEO + pagination (?page=) handling
  useEffect(() => {
    const pageParam = searchParams.get("page");
    const rawPage = Math.max(1, parseInt(pageParam || "1", 10) || 1);
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.min(rawPage, totalPages);
    const suffix = page > 1 ? ` — Page ${page}` : "";
    const title = `Watch Free 18+ Videos | ${labels.brandName}${suffix}`;
    document.title = title;
    const desc = `Watch free 18+ videos in HD on ${labels.brandName} — thousands of embedded adult videos, all models 18+, streaming via Eporner. No files hosted.${suffix}`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = desc;
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
    const base = (seo.canonicalBase.trim() || window.location.origin).replace(/\/$/, "");
    const canonicalPath = page > 1 ? `${base}/?page=${page}` : `${base}/`;
    upsert("property", "og:title", title);
    upsert("property", "og:description", desc);
    upsert("property", "og:type", "website");
    upsert("property", "og:url", canonicalPath);
    upsert("property", "og:site_name", seo.og.siteName || labels.brandName);
    const ogImg = absoluteUrl(base, seo.og.image || "/og-image.jpg");
    if (ogImg) {
      upsert("property", "og:image", ogImg);
      upsert("property", "og:image:width", "1200");
      upsert("property", "og:image:height", "630");
      upsert("property", "og:image:type", "image/jpeg");
      upsert("property", "og:image:alt", seo.og.imageAlt || title);
    }
    upsert("name", "robots", "index,follow");
    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", desc);
    if (ogImg) upsert("name", "twitter:image", ogImg);
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonicalPath;
    // pagination rel next/prev
    const upsertLink = (rel: string, href: string | null) => {
      let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (href) {
        if (!el) {
          el = document.createElement("link");
          el.rel = rel;
          document.head.appendChild(el);
        }
        el.href = href;
      } else {
        el?.remove();
      }
    };
    upsertLink("prev", page > 1 ? (page === 2 ? `${base}/` : `${base}/?page=${page - 1}`) : null);
    upsertLink("next", page < totalPages ? `${base}/?page=${page + 1}` : null);
    // Client CollectionPage + ItemList JSON-LD for homepage
    removeJsonLdByTypes(["CollectionPage", "ItemList"]);
    const collId = "ld-collection-index";
    const listId = "ld-itemlist-index";
    document.getElementById(collId)?.remove();
    document.getElementById(listId)?.remove();
    const collScript = document.createElement("script");
    collScript.id = collId;
    collScript.type = "application/ld+json";
    collScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description: desc,
      url: canonicalPath,
      isPartOf: { "@type": "WebSite", name: labels.brandName, url: `${base}/` },
    });
    document.head.appendChild(collScript);
    const sliceForLd = all.slice(0, 12);
    if (sliceForLd.length) {
      const listScript = document.createElement("script");
      listScript.id = listId;
      listScript.type = "application/ld+json";
      listScript.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        url: canonicalPath,
        numberOfItems: sliceForLd.length,
        itemListElement: sliceForLd.map((v, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}${watchPathFor(v)}`,
          name: v.title,
          image: v.thumbnail,
        })),
      });
      document.head.appendChild(listScript);
    }
    return () => {
      document.querySelector<HTMLLinkElement>('link[rel="next"]')?.remove();
      document.querySelector<HTMLLinkElement>('link[rel="prev"]')?.remove();
      document.getElementById(collId)?.remove();
      document.getElementById(listId)?.remove();
    };
  }, [labels.brandName, searchParams, all]);

  useEffect(() => {
    if (navType === "POP") {
      setShowDeferred(true);
      return;
    }
    setShowDeferred(false);
    const first = requestAnimationFrame(() => {
      const second = requestAnimationFrame(() => setShowDeferred(true));
      return () => cancelAnimationFrame(second);
    });
    return () => cancelAnimationFrame(first);
  }, [navType]);

  const featured = useMemo(() => {
    const f = all.filter((v) => v.featured);
    return f.length ? f.slice(0, 8) : all.slice(0, 8);
  }, [all]);
  // Daily hero rotation so the top slides stay fresh instead of showing the
  // same 5 videos until scores shift. Deterministic per day (SSR-safe).
  const heroSlides = useMemo(() => {
    if (!featured.length) return featured;
    const off = Math.floor(Date.now() / 86400000) % featured.length;
    return [...featured.slice(off), ...featured.slice(0, off)].slice(0, 5);
  }, [featured]);
  const trending = useMemo(
    () => (showDeferred ? all.filter((v) => v.trending) : []),
    [all, showDeferred],
  );
  const filtered = useMemo(
    () =>
      showDeferred ? (category === "all" ? all : all.filter((v) => v.category === category)) : [],
    [all, category, showDeferred],
  );

  // Pagination is primary for SEO crawlability (?page=). Infinite scroll is removed
  // as default; listing is paginated so bots can follow rel prev/next and crawlable links.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const currentPage = Math.min(rawPage, totalPages);
  const paginatedSlice = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );
  const displayVideos = paginatedSlice;
  const pageNumbers = getPaginationRange(currentPage, totalPages);
  const getPageHref = (p: number) => (p <= 1 ? "/" : `/?page=${p}`);
  const showPaginationUI = showDeferred && totalPages > 1;

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main>
        <h1 className="sr-only">Watch Free 18+ Videos — HDPORNFORYOU</h1>
        <Hero slides={heroSlides} />

        {showDeferred && featured.length > 0 && (
          <Row title={labels.featuredTitle} videos={featured} accent />
        )}

        {showDeferred && trending.length > 0 && (
          <Row title={labels.trendingTitle} videos={trending} />
        )}

        {showDeferred && <CategoryChips active={category} onChange={setCategory} />}

        {showDeferred && (
          <div className="max-w-7xl mx-auto px-4 md:px-8 mt-8 empty:hidden">
            <AdSlot placement="homeFeedBanner" format="banner" />
          </div>
        )}

        {showDeferred && (
          <section className="max-w-7xl mx-auto px-4 md:px-8 mt-8">
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mb-5">
              {labels.latestTitle}
            </h2>
            <p className="text-xs text-muted-foreground mb-3">All videos are embedded via Eporner — we do not host any files. 18+ only.</p>
            {displayVideos.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">
                No videos are available at the moment. Please check back shortly — new embedded content is added regularly.
              </p>
            ) : (
              <div className="grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {(() => {
                  const feedEvery = Math.max(2, getAds().intervals.homeNativeEvery || 8);
                  const adPlan = planFeedAdSlots(displayVideos.length, (idx) => {
                    const s = pickFeedSlot(idx, feedEvery, "home");
                    return s === "none" ? null : s;
                  }, feedEvery);
                  return displayVideos.map((v, i) => {
                  const adsHere = adPlan.get(i) ?? [];
                  const showNative = adsHere.includes("native");
                  const showOutstream = adsHere.includes("outstream");
                  const showBanner = adsHere.includes("banner");
                  return (
                    <Fragment key={v.id}>
                      <VideoCard video={v} />
                      {showNative && (
                        <AdSlot
                          placement="homeNativeFeed"
                          format="native"
                          label="Native sponsored"
                          className="col-span-full"
                        />
                      )}
                      {showOutstream && (
                        <OutstreamAd
                          placement="homeOutstream"
                          feed
                          className="col-span-full lg:col-span-2"
                        />
                      )}
                      {showBanner && (
                          <AdSlot placement="homeFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
                      )}
                    </Fragment>
                  );
                  });
                })()}
              </div>
            )}

            {showPaginationUI && (
              <nav aria-label="pagination" className="mt-10 flex max-w-full flex-nowrap items-center justify-center-safe gap-1 overflow-x-auto px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Link
                  to={currentPage <= 1 ? "#" : getPageHref(currentPage - 1)}
                  aria-disabled={currentPage <= 1}
                  aria-label="Previous page"
                  onClick={(e) => currentPage <= 1 && e.preventDefault()}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${currentPage <= 1 ? "pointer-events-none opacity-50 border-border bg-muted" : "border-border bg-background hover:bg-accent hover:text-accent-foreground"}`}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
                {pageNumbers.map((p, idx) =>
                  typeof p === "string" ? (
                    <span key={`${p}-${idx}`} className="inline-flex h-8 w-5 shrink-0 items-center justify-center text-muted-foreground sm:h-9 sm:w-9">
                      …
                    </span>
                  ) : (
                    <Link
                      key={p}
                      to={getPageHref(p)}
                      aria-current={p === currentPage ? "page" : undefined}
                      className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-medium transition-colors sm:h-9 sm:min-w-9 sm:px-3 sm:text-sm ${p === currentPage ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent hover:text-accent-foreground"}`}
                    >
                      {p}
                    </Link>
                  ),
                )}
                <Link
                  to={currentPage >= totalPages ? "#" : getPageHref(currentPage + 1)}
                  aria-disabled={currentPage >= totalPages}
                  aria-label="Next page"
                  onClick={(e) => currentPage >= totalPages && e.preventDefault()}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${currentPage >= totalPages ? "pointer-events-none opacity-50 border-border bg-muted" : "border-border bg-background hover:bg-accent hover:text-accent-foreground"}`}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </nav>
            )}
            {showPaginationUI && (
              <p className="mt-2 text-center text-xs text-muted-foreground">Page {currentPage} of {totalPages}</p>
            )}
          </section>
        )}

        {showDeferred && (
          <Row title={labels.recommendedTitle} videos={[...all].reverse().slice(0, 10)} />
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

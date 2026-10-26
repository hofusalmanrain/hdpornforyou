import { Fragment, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { VideoCard } from "@/components/site/VideoCard";
import { AdSlot } from "@/components/site/AdSlot";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";
import { useVideos } from "@/hooks/use-videos";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";
import { useLabels } from "@/hooks/use-labels";
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
  return range;
}

export default function TrendingPage() {
  const all = useVideos();
  const trendingAll = useMemo(() => all.filter((v) => v.trending), [all]);
  const labels = useLabels();
  const [searchParams] = useSearchParams();
  const every = Math.max(2, getAds().intervals.trendingNativeEvery || 7);

  const totalPages = Math.max(1, Math.ceil(trendingAll.length / PAGE_SIZE));
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const currentPage = Math.min(rawPage, totalPages);
  const trending = useMemo(
    () => trendingAll.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [trendingAll, currentPage],
  );
  const getPageHref = (p: number) => (p <= 1 ? "/trending" : `/trending?page=${p}`);
  const pageNumbers = getPaginationRange(currentPage, totalPages);

  useEffect(() => {
    const page = currentPage;
    const suffix = page > 1 ? ` — Page ${page}` : "";
    const title = `Trending 18+ Videos | ${labels.brandName}${suffix}`;
    document.title = title;
    const desc = `Trending 18+ videos on ${labels.brandName} — most watched embedded adult videos right now, all models 18+, streaming via Eporner.${suffix}`;
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
    const canonical = page > 1 ? `${base}/trending?page=${page}` : `${base}/trending`;
    upsert("property", "og:title", title);
    upsert("property", "og:description", desc);
    upsert("property", "og:type", "website");
    upsert("property", "og:url", canonical);
    upsert("property", "og:site_name", seo.og.siteName || labels.brandName);
    const ogImg = absoluteUrl(base, seo.og.image || "/og-image.jpg");
    if (ogImg) {
      upsert("property", "og:image", ogImg);
      upsert("property", "og:image:width", "1200");
      upsert("property", "og:image:height", "630");
      upsert("property", "og:image:type", "image/jpeg");
      upsert("property", "og:image:alt", seo.og.imageAlt || title);
    }
    upsert("name", "robots", trendingAll.length === 0 ? "noindex,follow" : "index,follow");
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
    link.href = canonical;
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
    upsertLink("prev", page > 1 ? (page === 2 ? `${base}/trending` : `${base}/trending?page=${page - 1}`) : null);
    upsertLink("next", page < totalPages ? `${base}/trending?page=${page + 1}` : null);
    removeJsonLdByTypes(["CollectionPage", "ItemList"]);
    const collId = "ld-collection-trending";
    const listId = "ld-itemlist-trending";
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
      url: canonical,
      isPartOf: { "@type": "WebSite", name: labels.brandName, url: `${base}/` },
    });
    document.head.appendChild(collScript);
    if (trending.length) {
      const listScript = document.createElement("script");
      listScript.id = listId;
      listScript.type = "application/ld+json";
      listScript.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        url: canonical,
        numberOfItems: trending.length,
        itemListElement: trending.map((v, i) => ({
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
  }, [labels.brandName, currentPage, totalPages, trending, trendingAll, all]);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8 animate-fade-up">
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
          <span className="text-gradient">🔥 Trending</span> on {labels.brandName}
        </h1>
        <p className="mt-2 text-muted-foreground">Most watched 18+ embedded videos right now — updated hourly.</p>

        <div className="mt-8 empty:hidden">
          <AdSlot placement="trendingFeedBanner" format="banner" />
        </div>

        <div className="mt-8 grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {(() => {
            const adPlan = planFeedAdSlots(trending.length, (idx) => {
              const s = pickFeedSlot(idx, every, "trending");
              return s === "none" ? null : s;
            }, every);
            return trending.map((v, i) => {
            const adsHere = adPlan.get(i) ?? [];
            const showNative = adsHere.includes("native");
            const showOutstream = adsHere.includes("outstream");
            const showBanner = adsHere.includes("banner");
            return (
              <Fragment key={v.id}>
                <VideoCard video={v} />
                {showNative && (
                    <AdSlot placement="trendingNative" format="native" label="Native sponsored" className="col-span-full" />
                )}
                {showOutstream && (
                  <OutstreamAd
                    placement="trendingOutstream"
                    feed
                    className="col-span-full lg:col-span-2"
                  />
                )}
                {showBanner && (
                    <AdSlot placement="trendingFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
                )}
              </Fragment>
            );
            });
          })()}
        </div>
        {trending.length === 0 && trendingAll.length === 0 && (
          <p className="mt-8 text-center text-muted-foreground">No trending videos yet.</p>
        )}
        {trendingAll.length > 0 && totalPages > 1 && (
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
                <span key={`${p}-${idx}`} className="inline-flex h-8 w-5 shrink-0 items-center justify-center text-muted-foreground sm:h-9 sm:w-9">…</span>
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
        {trendingAll.length > 0 && totalPages > 1 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">Page {currentPage} of {totalPages} · {trendingAll.length} videos</p>
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

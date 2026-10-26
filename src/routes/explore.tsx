import { Fragment, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { useLabels } from "@/hooks/use-labels";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { useCategories } from "@/hooks/use-categories";
import { useVideos } from "@/hooks/use-videos";
import { AdSlot } from "@/components/site/AdSlot";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";

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

export default function ExplorePage() {
  const videos = useVideos();
  const categories = useCategories();
  const labels = useLabels();
  const [searchParams] = useSearchParams();

  // SEO + pagination
  useEffect(() => {
    const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const filteredCount = categories.filter((c) => c.slug !== "all").length;
    const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
    const page = Math.min(rawPage, totalPages);
    const suffix = page > 1 ? ` — Page ${page}` : "";
    const title = `Explore Categories | ${labels.brandName}${suffix}`;
    document.title = title;
    const desc = `Browse 18+ categories on ${labels.brandName} — every section is indexed and embedded via Eporner. All models 18+, no files hosted.${suffix}`;
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
    const canonical = page > 1 ? `${base}/explore?page=${page}` : `${base}/explore`;
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
    upsertLink("prev", page > 1 ? (page === 2 ? `${base}/explore` : `${base}/explore?page=${page - 1}`) : null);
    upsertLink("next", page < totalPages ? `${base}/explore?page=${page + 1}` : null);
    // CollectionPage + ItemList JSON-LD for explore (categories)
    removeJsonLdByTypes(["CollectionPage", "ItemList"]);
    const collId = "ld-collection-explore";
    const listId = "ld-itemlist-explore";
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
    const catsForLd = categories.filter((c) => c.slug !== "all").slice(0, 12);
    if (catsForLd.length) {
      const listScript = document.createElement("script");
      listScript.id = listId;
      listScript.type = "application/ld+json";
      listScript.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        url: canonical,
        numberOfItems: catsForLd.length,
        itemListElement: catsForLd.map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}/category/${c.slug}`,
          name: c.name,
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
  }, [searchParams, videos, categories, labels.brandName]);

  const filteredCats = useMemo(() => categories.filter((c) => c.slug !== "all"), [categories]);
  const totalPages = Math.max(1, Math.ceil(filteredCats.length / PAGE_SIZE));
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const currentPage = Math.min(rawPage, totalPages);
  const paginatedCats = useMemo(
    () => filteredCats.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredCats, currentPage],
  );
  const getPageHref = (p: number) => (p <= 1 ? "/explore" : `/explore?page=${p}`);
  const pageNumbers = getPaginationRange(currentPage, totalPages);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8 animate-fade-up">
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
          Explore <span className="text-gradient">Categories</span>
        </h1>
        <p className="mt-2 text-muted-foreground">
          Browse 18+ categories — every section is indexed and embedded via Eporner. All models 18+.
        </p>

        <div className="mt-8 empty:hidden">
          <AdSlot placement="exploreFeedBanner" format="banner" />
        </div>

        <div className="mt-10 grid grid-flow-row-dense grid-cols-2 lg:grid-cols-3 gap-4">
          {(() => {
            const feedEvery = Math.max(2, getAds().intervals.exploreNativeEvery || 8);
            const adPlan = planFeedAdSlots(paginatedCats.length, (idx) => {
              const s = pickFeedSlot(idx, feedEvery, "explore");
              return s === "none" ? null : s;
            }, feedEvery);
            return paginatedCats.map((c, i) => {
              const count = videos.filter((v) => v.category === c.slug).length;
              const cover = videos.find((v) => v.category === c.slug)?.thumbnail;
              const adsHere = adPlan.get(i) ?? [];
              const showNative = adsHere.includes("native");
              const showOutstream = adsHere.includes("outstream");
              const showBanner = adsHere.includes("banner");
              return (
                <Fragment key={c.slug}>
                  <Link
                    key={c.slug}
                    to={`/category/${c.slug}`}
                    className="explore-card group relative aspect-[4/3] overflow-hidden rounded-2xl shadow-card hover:shadow-glow transition-all"
                  >
                    {cover && (
                      <img
                        src={cover}
                        alt={c.name}
                        width={640}
                        height={360}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover scale-105 group-hover:scale-125 transition-transform duration-700"
                      />
                    )}
                    <div className="card-wash absolute inset-0 bg-gradient-to-tr from-background via-background/40 to-transparent" />
                    <div className="absolute inset-0 p-5 flex flex-col justify-end">
                      <span className="text-3xl">{c.icon}</span>
                      <h3 className="mt-2 font-display text-2xl font-bold">{c.name}</h3>
                      <p className="text-xs text-muted-foreground">{count} videos</p>
                    </div>
                  </Link>
                  {showNative && (
                      <AdSlot placement="exploreNative" format="native" label="Native sponsored" className="col-span-full" />
                  )}
                  {showOutstream && (
                    <OutstreamAd
                      placement="exploreOutstream"
                      feed
                      className="col-span-full lg:col-span-2"
                    />
                  )}
                  {showBanner && (
                      <AdSlot placement="exploreFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
                  )}
                </Fragment>
              );
              });
          })()}
        </div>

        {totalPages > 1 && (
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
        {totalPages > 1 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">Page {currentPage} of {totalPages}</p>
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

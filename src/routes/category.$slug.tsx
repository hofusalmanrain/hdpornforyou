import { Link, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { VideoCard } from "@/components/site/VideoCard";
import { AdSlot } from "@/components/site/AdSlot";
import { Fragment, useEffect, useMemo } from "react";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";
import { useCategories } from "@/hooks/use-categories";
import { useVideos } from "@/hooks/use-videos";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";
import { useLabels } from "@/hooks/use-labels";
import { watchPathFor } from "@/data/videos";

const PAGE_SIZE = 22;
const CATEGORY_MIN_VIDEOS = 2;

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

export default function CategoryPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const categories = useCategories();
  const labels = useLabels();
  const cat = categories.find((c) => c.slug === slug);
  const allForCat = useVideos().filter((v) => v.category === slug);
  const [searchParams] = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(allForCat.length / PAGE_SIZE));
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const currentPage = Math.min(rawPage, totalPages);
  const list = useMemo(
    () => allForCat.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [allForCat, currentPage],
  );
  const getPageHref = (p: number) => (p <= 1 ? `/category/${slug}` : `/category/${slug}?page=${p}`);
  const pageNumbers = getPaginationRange(currentPage, totalPages);

  useEffect(() => {
    if (!cat) return;
    const page = currentPage;
    const suffix = page > 1 ? ` — Page ${page}` : "";
    const title = `${cat.name} Videos - Watch ${cat.name} in HD | ${labels.brandName}${suffix}`;
    document.title = title;
    const desc = `Watch ${allForCat.length} ${cat.name} porn videos in HD on ${labels.brandName}. Free 18+ ${cat.name} streaming, embedded via Eporner.${suffix}`;
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
    const canonicalPath = page > 1 ? `${base}/category/${slug}?page=${page}` : `${base}/category/${slug}`;
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
      upsert("property", "og:image:alt", `${cat?.name} videos`);
    }
    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", desc);
    if (ogImg) upsert("name", "twitter:image", ogImg);
    // handle thin category pages
    upsert("name", "robots", allForCat.length < CATEGORY_MIN_VIDEOS ? "noindex,follow" : "index,follow");
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonicalPath;
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
    upsertLink("prev", page > 1 ? (page === 2 ? `${base}/category/${slug}` : `${base}/category/${slug}?page=${page - 1}`) : null);
    upsertLink("next", page < totalPages ? `${base}/category/${slug}?page=${page + 1}` : null);
    removeJsonLdByTypes(["CollectionPage", "ItemList", "BreadcrumbList"]);
    const collId = "ld-collection-category";
    const listId = "ld-itemlist-category";
    const bcId = "ld-breadcrumb-category";
    document.getElementById(collId)?.remove();
    document.getElementById(listId)?.remove();
    document.getElementById(bcId)?.remove();
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
    if (list.length) {
      const listScript = document.createElement("script");
      listScript.id = listId;
      listScript.type = "application/ld+json";
      listScript.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: title,
        url: canonicalPath,
        numberOfItems: list.length,
        itemListElement: list.map((v, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${base}${watchPathFor(v)}`,
          name: v.title,
          image: v.thumbnail,
        })),
      });
      document.head.appendChild(listScript);
    }
    const bcScript = document.createElement("script");
    bcScript.id = bcId;
    bcScript.type = "application/ld+json";
    bcScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
        { "@type": "ListItem", position: 2, name: cat?.name, item: canonicalPath },
      ],
    });
    document.head.appendChild(bcScript);
    return () => {
      document.querySelector<HTMLLinkElement>('link[rel="next"]')?.remove();
      document.querySelector<HTMLLinkElement>('link[rel="prev"]')?.remove();
      document.getElementById(collId)?.remove();
      document.getElementById(listId)?.remove();
      document.getElementById(bcId)?.remove();
    };
  }, [cat, list, allForCat, slug, labels.brandName, currentPage, totalPages]);

  // 404 for unknown category: ensure robots noindex,follow and cleanup
  useEffect(() => {
    if (cat) return;
    let el = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "robots");
      document.head.appendChild(el);
    }
    const prev = el.content;
    el.content = "noindex,follow";
    // Ensure canonical does not point to indexable URL for invalid category
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevHref = link?.href || "";
    if (link) link.remove();
    // Also set a noindex-friendly title for invalid category
    const prevTitle = document.title;
    document.title = `Category Not Found | ${labels.brandName}`;
    return () => {
      const cur = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (cur) cur.content = prev || "index,follow";
      document.title = prevTitle;
      if (prevHref) {
        // let next route recreate canonical; don't restore stale
      }
    };
  }, [cat, labels.brandName]);

  if (!cat) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-32 text-center animate-fade-up">
          <h1 className="font-display text-3xl">Category Not Found</h1>
          <p className="text-muted-foreground mt-2">The category you’re looking for doesn’t exist.</p>
          <Link to="/explore" className="text-primary underline mt-4 inline-block">
            Browse All Categories
          </Link>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8 animate-fade-up">
        <div className="flex items-end gap-4">
          <span className="text-5xl">{cat.icon}</span>
          <div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              {cat.name}
            </h1>
            <p className="text-muted-foreground">{allForCat.length} videos — 18+ embedded content</p>
          </div>
        </div>

        <div className="mt-8 empty:hidden">
          <AdSlot placement="categoryFeedBanner" format="banner" />
        </div>

        {allForCat.length === 0 ? (
          <p className="mt-12 text-center text-muted-foreground">No videos in this category yet. New embedded content is added regularly — check back soon.</p>
        ) : (
          <>
            <div className="mt-8 grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {(() => {
                const feedEvery = Math.max(2, getAds().intervals.categoryNativeEvery || 8);
                const adPlan = planFeedAdSlots(list.length, (idx) => {
                  const s = pickFeedSlot(idx, feedEvery, "category");
                  return s === "none" ? null : s;
                }, feedEvery);
                return list.map((v, i) => {
                const adsHere = adPlan.get(i) ?? [];
                const showNative = adsHere.includes("native");
                const showOutstream = adsHere.includes("outstream");
                const showBanner = adsHere.includes("banner");
                return (
                  <Fragment key={v.id}>
                    <VideoCard video={v} />
                    {showNative && (
                        <AdSlot placement="categoryNative" format="native" label="Native sponsored" className="col-span-full" />
                    )}
                    {showOutstream && (
                      <OutstreamAd
                        placement="categoryOutstream"
                        feed
                        className="col-span-full lg:col-span-2"
                      />
                    )}
                    {showBanner && (
                        <AdSlot placement="categoryFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
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
          </>
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

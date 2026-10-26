import { Link, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo } from "react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { VideoCard } from "@/components/site/VideoCard";
import { AdSlot } from "@/components/site/AdSlot";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";
import { useVideos } from "@/hooks/use-videos";
import { slugify, watchPathFor } from "@/data/videos";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";
import { useLabels } from "@/hooks/use-labels";

const PAGE_SIZE = 22;
const TAG_MIN_VIDEOS = Math.max(
  1,
  Number(import.meta.env.VITE_TAG_MIN_VIDEOS) || 2,
);

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

export default function TagsPage() {
  const { tag = "" } = useParams<{ tag: string }>();
  const labels = useLabels();
  const all = useVideos();
  // SEO-friendly: URL is hyphenated /tags/big-tits, match against slugified tags (big tits -> big-tits) and support legacy %20
  const displayTag = decodeURIComponent(tag).replace(/-/g, " ").trim();
  const allForTag = useMemo(
    () => all.filter((v) => v.tags?.some((t) => slugify(t) === slugify(displayTag))),
    [all, displayTag],
  );
  const [searchParams] = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(allForTag.length / PAGE_SIZE));
  const rawPage = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const currentPage = Math.min(rawPage, totalPages);
  const list = useMemo(
    () => allForTag.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [allForTag, currentPage],
  );
  const slug = slugify(displayTag);
  const getPageHref = (p: number) => (p <= 1 ? `/tags/${slug}` : `/tags/${slug}?page=${p}`);
  const pageNumbers = getPaginationRange(currentPage, totalPages);

  useEffect(() => {
    const page = currentPage;
    const suffix = page > 1 ? ` — Page ${page}` : "";
    const title = `${displayTag} Videos - Watch ${displayTag} in HD | ${labels.brandName}${suffix}`;
    document.title = title;
    const desc = `Watch ${allForTag.length} ${displayTag} videos in HD on ${labels.brandName}. Free 18+ ${displayTag} porn, embedded via Eporner — no files hosted.${suffix}`;
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
    const canonical = page > 1 ? `${base}/tags/${slug}?page=${page}` : `${base}/tags/${slug}`;
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
      upsert("property", "og:image:alt", `${displayTag} videos`);
    }
    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", desc);
    if (ogImg) upsert("name", "twitter:image", ogImg);
    upsert(
      "name",
      "robots",
      allForTag.length < TAG_MIN_VIDEOS ? "noindex,follow" : "index,follow",
    );
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
    upsertLink("prev", page > 1 ? (page === 2 ? `${base}/tags/${slug}` : `${base}/tags/${slug}?page=${page - 1}`) : null);
    upsertLink("next", page < totalPages ? `${base}/tags/${slug}?page=${page + 1}` : null);
    removeJsonLdByTypes(["CollectionPage", "ItemList", "BreadcrumbList"]);
    const collId = "ld-collection-tags";
    const listId = "ld-itemlist-tags";
    const bcId = "ld-breadcrumb-tags";
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
      url: canonical,
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
        url: canonical,
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
        { "@type": "ListItem", position: 2, name: displayTag, item: canonical },
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
  }, [displayTag, allForTag, list, slug, labels.brandName, currentPage, totalPages]);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8 animate-fade-up">
        <div>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">{displayTag}</h1>
          <p className="text-muted-foreground mt-1">{allForTag.length} videos — 18+ embedded content</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">All videos are embedded via Eporner API. We do not host any files.</p>

        <div className="mt-8 empty:hidden">
          <AdSlot placement="tagsFeedBanner" format="banner" />
        </div>

        {allForTag.length === 0 ? (
          <div className="mt-12 text-center text-muted-foreground">
            <p>
              No videos found for <strong>{displayTag}</strong>.
            </p>
            <Link to="/" className="text-primary underline mt-4 inline-block">
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-8 grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(() => {
                const feedEvery = Math.max(2, getAds().intervals.tagsNativeEvery || 6);
                const adPlan = planFeedAdSlots(list.length, (idx) => {
                  const s = pickFeedSlot(idx, feedEvery, "tags");
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
                        <AdSlot placement="tagsNative" format="native" label="Native sponsored" className="col-span-full" />
                    )}
                    {showOutstream && (
                      <OutstreamAd
                        placement="tagsOutstream"
                        feed
                        className="col-span-full lg:col-span-2"
                      />
                    )}
                    {showBanner && (
                        <AdSlot placement="tagsFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
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

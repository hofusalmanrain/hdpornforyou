import { useLabels } from "@/hooks/use-labels";
import { Search as SearchIcon, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
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
import { absoluteUrl } from "@/lib/seo-head";

// High-SEO tags only: top-traffic terms that all resolve to indexable tag
// landing pages. Rendered as crawlable internal links, capped to two rows.
// Curated fallback until real traffic ranks the dynamic list.
const HIGH_SEO_TAGS = [
  "hd-porn",
  "milf",
  "lesbian",
  "hardcore",
  "threesome",
  "solo",
  "interracial",
  "brunette",
];
const tagLabel = (slug: string) => slug.replace(/-/g, " ");

export default function SearchPage() {
  const all = useVideos();
  const labels = useLabels();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  // Category filter UI removed (tags-only page); always "all".
  const [cat] = useState<string>("all");
  // Dynamic popular tags ranked by real tag-page traffic (last 30 days).
  // Falls back to the curated high-SEO list until traffic exists.
  const [popularTags, setPopularTags] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/tags/popular?limit=12")
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        const tags = Array.isArray(j?.tags)
          ? j.tags.filter((t: unknown): t is string => typeof t === "string")
          : [];
        if (tags.length) setPopularTags(tags.slice(0, 12));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const video of all) {
      for (const tag of video.tags ?? []) {
        const slug = tag
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [all]);
  const minTagVideos = Math.max(1, Number(import.meta.env.VITE_TAG_MIN_VIDEOS) || 2);
  const shownTags = (popularTags ?? HIGH_SEO_TAGS).filter(
    (tag) => (availableTags.get(tag) ?? 0) >= minTagVideos,
  );

  // Sync local input when the URL ?q= changes underneath us (e.g. a topbar
  // search while already on /search — same route, no remount). Identical
  // values bail out, so this can't loop with the writer effect below.
  const paramQ = params.get("q") ?? "";
  useEffect(() => {
    setQ((prev) => (prev === paramQ ? prev : paramQ));
  }, [paramQ]);

  // SEO: noindex, title/meta/canonical/OG/twitter, canonical always /search without q
  useEffect(() => {
    const trimmed = q.trim();
    const title = trimmed ? `Search results for "${trimmed}" | ${labels.brandName}` : `Search | ${labels.brandName}`;
    document.title = title;
    const desc = trimmed
      ? `Search results for "${trimmed}" on ${labels.brandName} — browse free 18+ embedded videos, all models 18+.`
      : `Search free 18+ videos on ${labels.brandName} — all content embedded via Eporner, no files hosted.`;
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
    upsert("property", "og:title", title);
    upsert("property", "og:description", desc);
    upsert("property", "og:type", "website");
    upsert("property", "og:url", `${base}/search`);
    upsert("property", "og:site_name", seo.og.siteName || labels.brandName);
    const ogImg = absoluteUrl(base, seo.og.image || "/og-image.jpg");
    if (ogImg) {
      upsert("property", "og:image", ogImg);
      upsert("property", "og:image:width", "1200");
      upsert("property", "og:image:height", "630");
      upsert("property", "og:image:type", "image/jpeg");
      upsert("property", "og:image:alt", seo.og.imageAlt || title);
    }
    upsert("name", "twitter:card", "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", title);
    upsert("name", "twitter:description", desc);
    if (ogImg) upsert("name", "twitter:image", ogImg);
    upsert("name", "robots", "noindex,follow");
    // canonical without q param
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = `${base}/search`;
    return () => {
      // cleanup robots on unmount: restore to index,follow so next page not stuck noindex
      const r = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (r) r.content = "index,follow";
    };
  }, [q, labels.brandName]);

  useEffect(() => {
    // Skip the replace when the URL already matches — otherwise the mount
    // effect fires a no-op REPLACE navigation that clobbers the scroll
    // position restored by back-press (ScrollToTop treats REPLACE as
    // "scroll to top").
    const current = params.get("q") ?? "";
    if (current === q.trim()) return;
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const results = useMemo(() => {
    const raw = q.trim();
    if (!raw) return [];
    // Tags search: strip leading # and match tags only
    const isTagSearch = raw.startsWith("#");
    const term = isTagSearch ? raw.slice(1).toLowerCase() : raw.toLowerCase();
    return all.filter((v) => {
      const matchCat = cat === "all" || v.category === cat;
      const matchTerm =
        !term ||
        (isTagSearch
          ? v.tags.some((t) => t.toLowerCase() === term)
          : v.title.toLowerCase().includes(term) ||
            v.description.toLowerCase().includes(term) ||
            v.channel.toLowerCase().includes(term) ||
            v.tags.some((t) => t.toLowerCase().includes(term)));
      return matchCat && matchTerm;
    });
  }, [all, q, cat]);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8 animate-fade-up">
        <div className="max-w-2xl mx-auto">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-center">
            Search <span className="text-gradient">{labels.brandName}</span>
          </h1>
          <p className="text-center text-sm text-muted-foreground mt-1">18+ only — All videos are embedded via Eporner.</p>
          <div className="mt-6 relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search titles, categories or tags…"
              className="w-full rounded-full glass border border-border focus:border-primary/60 pl-12 pr-12 py-4 text-lg outline-none focus:shadow-glow transition-all"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full hover:bg-secondary flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {!q && (
            <div className="mt-6">
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Popular searches
              </p>
              <div className="chip-row flex flex-wrap gap-2 max-h-[76px] overflow-hidden">
                {shownTags.map((t) => (
                  <Link
                    key={t}
                    to={`/tags/${t}`}
                    className="rounded-full glass px-3 py-1.5 text-sm hover:gradient-primary hover:text-primary-foreground transition-all"
                  >
                    {tagLabel(t)}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-10 empty:hidden">
          <AdSlot placement="searchFeedBanner" format="banner" />
        </div>

        <div className="mt-8">
          <p className="text-sm text-muted-foreground mb-4">
            {results.length} result{results.length === 1 ? "" : "s"}
            {q && ` for “${q}”`} — 18+ embedded content only
          </p>
          {results.length === 0 ? (
            <p className="text-center text-muted-foreground py-20">
              {q.trim()
                ? "No results for this query. Try a different keyword or category."
                : "Search by title, category, or tags."}
            </p>
          ) : (
            <div className="grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(() => {
                const feedEvery = Math.max(2, getAds().intervals.searchNativeEvery || 6);
                const adPlan = planFeedAdSlots(results.length, (idx) => {
                  const s = pickFeedSlot(idx, feedEvery, "search");
                  return s === "none" ? null : s;
                }, feedEvery);
                return results.map((v, i) => {
                const adsHere = adPlan.get(i) ?? [];
                const showNative = adsHere.includes("native");
                const showOutstream = adsHere.includes("outstream");
                const showBanner = adsHere.includes("banner");
                return (
                  <Fragment key={v.id}>
                    <VideoCard video={v} />
                    {showNative && (
                        <AdSlot placement="searchNative" format="native" label="Native sponsored" className="col-span-full" />
                    )}
                    {showOutstream && (
                      <OutstreamAd
                        placement="searchOutstream"
                        feed
                        className="col-span-full lg:col-span-2"
                      />
                    )}
                    {showBanner && (
                        <AdSlot placement="searchFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
                    )}
                  </Fragment>
                );
                });
              })()}
            </div>
          )}
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

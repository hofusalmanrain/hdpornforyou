import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Search,
  Check,
  Download,
  ChevronLeft,
  ChevronRight,
  Flame,
  Star,
  Brain,
} from "lucide-react";
import { bulkImport, getAllVideos, hydrateVideos } from "@/lib/video-store";
import { categories, type Video } from "@/data/videos";

interface EpornerVideo {
  id: string;
  title: string;
  embed: string;
  default_thumb: { src: string };
  length_min: string;
  views: number;
  rate: string;
}

interface EpornerDraft {
  epornerId: string;
  title: string;
  slug: string;
  autoSlug: boolean;
  description: string;
  tags: string;
  category: string;
  channel: string;
  duration: string;
  thumbnail: string;
  embedUrl: string;
  selected: boolean;
  featured: boolean;
  trending: boolean;
  views: number;
  rating: string;
  alreadyImported: boolean;
}

function wordTrunc(s: string, max: number): string {
  if (!s || s.length <= max) return s || "";
  const cut = s.slice(0, max);
  const last = cut.lastIndexOf(" ");
  return last > 0 ? cut.slice(0, last) : cut;
}

// Normalize an AI tag: lowercase, spaces allowed (1-2 words), strip leading "#".
// e.g. "Mia Khalifa" -> "mia khalifa", "BIG TITS" -> "big tits"
function normalizeAiTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateTags(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const unique = Array.from(new Set(words));
  return unique.slice(0, 10);
}

export function VideoImporter() {
  const [searchQuery, setSearchQuery] = useState("");
  const [perPage, setPerPage] = useState(20);
  const [order, setOrder] = useState("latest");
  const [thumbsize, setThumbsize] = useState("big");
  const [lowQuality, setLowQuality] = useState("0");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [epornerDrafts, setEpornerDrafts] = useState<EpornerDraft[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [existingEmbedUrls, setExistingEmbedUrls] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Hydrate video store on mount then load existing embed URLs
  useEffect(() => {
    let cancelled = false;
    hydrateVideos()
      .then(() => {
        if (cancelled) return;
        refreshExistingUrls();
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return epornerDrafts;
    return epornerDrafts.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.channel.toLowerCase().includes(q) ||
        d.tags.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    );
  }, [epornerDrafts, query]);

  const availableCategories = categories.filter((c) => c.slug !== "all");

  const refreshExistingUrls = () => {
    const all = getAllVideos();
    const urls = new Set<string>();
    all.forEach((v) => {
      if (v.embedUrl) urls.add(v.embedUrl);
    });
    setExistingEmbedUrls(urls);
  };

  const enrichWithAI = useCallback(
    async (drafts: EpornerDraft[]) => {
      setAiLoading(true);
      const candidates = drafts.filter((d) => !d.alreadyImported);
      if (!candidates.length) {
        setAiLoading(false);
        return drafts;
      }

      let currentDrafts = [...drafts];
      let totalEnriched = 0;

      for (let attempt = 0; attempt < 5; attempt++) {
        const missing = currentDrafts.filter((d) => !d.alreadyImported && !d.description);
        if (!missing.length) break;

        setMsg(`AI enriching ${missing.length} missing videos (attempt ${attempt + 1})...`);
        try {
          const payload = missing.map((d) => ({
            video_id: d.epornerId,
            id: d.epornerId,
            title: d.title,
            sourceUrl: `https://www.eporner.com/video-${d.epornerId}/${slugify(d.title)}`,
            channel: d.channel,
            duration: d.duration,
            views: d.views,
            tags: d.tags,
          }));
          const res = await fetch("/api/admin/ai/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ videos: payload }),
            signal: AbortSignal.timeout(120000),
          });
          if (!res.ok) {
            let serverMsg = `AI error ${res.status}`;
            try {
              const errBody = await res.json();
              if (errBody?.error) serverMsg = errBody.error;
            } catch {
              /* ignore */
            }
            throw new Error(serverMsg);
          }
          const data = await res.json();
          const seoMap = new Map<
            string,
            { title?: string; description?: string; tags?: string[]; category?: string }
          >();
          for (const r of data.results || []) {
            if (r.video_id) seoMap.set(String(r.video_id), r);
          }
          let batchEnriched = 0;
          currentDrafts = currentDrafts.map((d) => {
            const seo = seoMap.get(d.epornerId);
            if (!seo || d.alreadyImported) return d;
            if (!seo.description) return d;
            batchEnriched++;
            const newTitle = (seo.title || d.title).trim().slice(0, 120);
            return {
              ...d,
              title: newTitle,
              slug: slugify(newTitle),
              description: (seo.description || "").trim().slice(0, 600),
              tags: seo.tags?.length
                ? seo.tags.map(normalizeAiTag).filter(Boolean).join(", ")
                : d.tags,
              category:
                availableCategories.find((c) => c.slug === seo.category)?.slug || d.category,
            };
          });
          totalEnriched += batchEnriched;
        } catch (e) {
          console.error("[AI enrich]", e);
          setMsg(`AI enrichment failed on attempt ${attempt + 1}: ${(e as Error).message}`);
          break;
        }
      }

      setEpornerDrafts(currentDrafts);
      const total = candidates.length;
      const remaining = currentDrafts.filter((d) => !d.alreadyImported && !d.description).length;
      if (remaining > 0) {
        setMsg(
          `AI enriched ${totalEnriched}/${total} videos. ${remaining} still missing — click "Re-enrich AI" to retry.`,
        );
      } else {
        setMsg(`All ${totalEnriched} videos enriched.`);
      }
      setAiLoading(false);
      return currentDrafts;
    },
    [availableCategories],
  );

  const searchEporner = async (page = 1) => {
    if (!searchQuery.trim()) {
      setMsg("Please enter a search term.");
      return;
    }
    setLoading(true);
    setMsg(`Searching EPORNER for "${searchQuery}"...`);
    try {
      const url = `/api/eporner/video/search?query=${encodeURIComponent(searchQuery)}&per_page=${perPage}&page=${page}&thumbsize=${thumbsize}&order=${order}&gay=0&lq=${lowQuality}&format=json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      if (data.videos && data.videos.length > 0) {
        refreshExistingUrls();
        const fetched: EpornerDraft[] = data.videos.map((video: EpornerVideo) => {
          const randomCategory =
            availableCategories[Math.floor(Math.random() * availableCategories.length)]?.slug ||
            "all";
          const views = Math.floor(Math.random() * (20_000_000 - 1_000_000 + 1) + 1_000_000);
          const tags = generateTags(video.title).join(", ");
          const slug = slugify(video.title);
          const alreadyImported = getAllVideos().some((v) => v.embedUrl === video.embed);
          return {
            epornerId: video.id,
            title: video.title,
            slug,
            autoSlug: true,
            description: "",
            tags,
            category: randomCategory,
            channel: "EPORNER",
            duration: (() => {
              const raw = video.length_min || "0:00";
              const p = raw.split(":").map(Number);
              if (p.length === 3)
                return `${String(p[0]).padStart(2, "0")}:${String(p[1]).padStart(2, "0")}:${String(p[2]).padStart(2, "0")}`;
              const m = p[0] || 0,
                s = p[1] || 0,
                h = Math.floor(m / 60),
                rm = m % 60;
              return `${String(h).padStart(2, "0")}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            })(),
            thumbnail: video.default_thumb?.src || "",
            embedUrl: video.embed,
            selected: !alreadyImported,
            featured: false,
            trending: false,
            views,
            rating: video.rate || "0",
            alreadyImported,
          };
        });
        setEpornerDrafts(fetched);
        setTotalPages(data.total_pages || Math.ceil((data.total_count || 0) / perPage));
        setTotalResults(data.total_count || 0);
        setCurrentPage(data.page || page);
        setMsg(`Found ${data.total_count || data.videos.length} videos. ${fetched.length} loaded.`);
        // Auto-enrich with AI (non-blocking, updates drafts in place)
        if (aiEnabled) enrichWithAI(fetched);
      } else {
        setMsg("No videos found.");
        setEpornerDrafts([]);
      }
    } catch (error) {
      console.error(error);
      setMsg("Failed to fetch from EPORNER.");
      setEpornerDrafts([]);
    } finally {
      setLoading(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<EpornerDraft>) =>
    setEpornerDrafts((drafts) =>
      drafts.map((d) => {
        if (d.epornerId !== id) return d;
        const updated = { ...d, ...patch };
        if (patch.title && updated.autoSlug) {
          updated.slug = slugify(updated.title);
        }
        return updated;
      }),
    );

  const removeDraft = (id: string) => setEpornerDrafts((d) => d.filter((x) => x.epornerId !== id));

  const selectedCount = epornerDrafts.filter((d) => d.selected && !d.alreadyImported).length;

  const importSelected = async () => {
    const picked = epornerDrafts.filter((d) => d.selected && !d.alreadyImported);
    if (picked.length === 0) {
      setMsg("No new videos selected for import.");
      return;
    }
    const rows: Partial<Video>[] = picked.map((d) => {
      let finalSlug = d.slug;
      if (d.autoSlug) finalSlug = slugify(d.title);
      // Random uploadedAt between 2020-01-01 and today
      const start = new Date("2020-01-01").getTime();
      const uploadedAt = new Date(start + Math.random() * (Date.now() - start))
        .toISOString()
        .slice(0, 10);
      return {
        id: d.epornerId,
        slug: finalSlug,
        title: d.title,
        description: d.description.slice(0, 600),
        embedUrl: d.embedUrl,
        sourceUrl: `https://www.eporner.com/video-${d.epornerId}/${slugify(d.title)}`,
        thumbnail: d.thumbnail,
        duration: d.duration,
        category: d.category,
        tags: d.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        channel: d.channel,
        hd: lowQuality === "0",
        featured: d.featured,
        trending: d.trending,
        uploadedAt,
        views: d.views,
        likes: Math.floor(d.views * (parseFloat(d.rating) / 10)),
      };
    });
    const n = await bulkImport(rows);
    await hydrateVideos();
    refreshExistingUrls();
    const importedUrls = new Set(getAllVideos().map((v) => v.embedUrl));
    setEpornerDrafts((drafts) => drafts.filter((x) => !importedUrls.has(x.embedUrl)));
    setMsg(`Imported ${n} EPORNER videos.`);
  };

  const toggleAll = (val: boolean) =>
    setEpornerDrafts((d) => d.map((x) => ({ ...x, selected: val && !x.alreadyImported })));

  const changePage = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    searchEporner(newPage);
  };

  if (!hydrated) {
    return (
      <div className="rounded-2xl gradient-card p-6 shadow-card">
        <p className="text-muted-foreground">Loading video catalog...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl gradient-card p-6 shadow-card">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" /> EPORNER Bulk Importer
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          Search EPORNER. Already imported videos are unselected and disabled. Slugs auto-generate
          from title. Category is randomly assigned — change it per video. Default:{" "}
          <strong>FHD only, big thumbnails</strong>. Description capped at{" "}
          <strong>600 chars</strong>, title at <strong>120 chars</strong>.
        </p>

        <div className="mt-3 space-y-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchEporner()}
            placeholder="Search term..."
            className="w-full rounded-xl bg-background border border-border focus:border-primary/60 px-4 py-3 text-sm outline-none focus:shadow-glow"
          />
          <div className="flex flex-wrap gap-3">
            <select
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="rounded-full bg-background border border-border px-4 py-2 text-sm"
            >
              <option value="latest">Latest</option>
              <option value="most-popular">Most Popular</option>
              <option value="top-rated">Top Rated</option>
              <option value="top-weekly">Top Weekly</option>
              <option value="top-monthly">Top Monthly</option>
              <option value="longest">Longest</option>
              <option value="shortest">Shortest</option>
            </select>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              className="rounded-full bg-background border border-border px-4 py-2 text-sm"
            >
              <option value={10}>10 per page</option>
              <option value={20}>20 per page</option>
              <option value={30}>30 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </select>
            <select
              value={thumbsize}
              onChange={(e) => setThumbsize(e.target.value)}
              className="rounded-full bg-background border border-border px-4 py-2 text-sm"
            >
              <option value="small">Small thumbnail</option>
              <option value="medium">Medium thumbnail</option>
              <option value="big">Big thumbnail</option>
            </select>
            <select
              value={lowQuality}
              onChange={(e) => setLowQuality(e.target.value)}
              className="rounded-full bg-background border border-border px-4 py-2 text-sm"
            >
              <option value="0">FHD only (no low quality)</option>
              <option value="1">Include low quality (HD + LQ)</option>
            </select>
            <button
              onClick={() => searchEporner()}
              disabled={loading || !searchQuery.trim()}
              className="inline-flex items-center gap-2 rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-50"
            >
              <Search className="h-4 w-4" /> {loading ? "Searching..." : "Search EPORNER"}
            </button>
            <button
              onClick={() => setAiEnabled((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all ${aiEnabled ? "gradient-primary text-primary-foreground shadow-glow" : "glass text-muted-foreground"}`}
            >
              <Brain className="h-4 w-4" /> AI {aiEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        {aiLoading && (
          <p className="mt-3 text-xs text-primary/80 flex items-center gap-1">
            <Brain className="h-3 w-3 animate-pulse" /> AI enriching metadata...
          </p>
        )}
        {msg && !aiLoading && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
      </div>

      {epornerDrafts.length > 0 && (
        <div className="rounded-2xl gradient-card p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-display text-lg font-bold">
              {epornerDrafts.length} previews{" "}
              {currentPage > 1 && `(Page ${currentPage} of ${totalPages})`}
              {totalResults > 0 && ` — ${totalResults} total videos`}
            </h4>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter previews..."
                className="rounded-full bg-background border border-border px-4 py-2 text-sm w-full sm:w-auto"
              />
              <button
                onClick={() => toggleAll(true)}
                className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
              >
                Select all new
              </button>
              <button
                onClick={() => toggleAll(false)}
                className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
              >
                Deselect all
              </button>
              <button
                onClick={() => enrichWithAI(epornerDrafts)}
                disabled={aiLoading || !aiEnabled}
                className="inline-flex items-center gap-2 rounded-full bg-secondary/60 text-foreground px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-40"
              >
                <Brain className="h-4 w-4" /> {aiLoading ? "AI enriching..." : "Re-enrich AI"}
              </button>
              <button
                onClick={importSelected}
                disabled={!selectedCount}
                className="inline-flex items-center gap-2 rounded-full bg-primary/20 text-primary px-4 py-2 text-sm font-semibold hover:bg-primary/30 disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> Import {selectedCount || ""} selected
              </button>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 mb-2">
              <button
                onClick={() => changePage(currentPage - 1)}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/50 px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => changePage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/50 px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((d) => (
              <article
                key={d.epornerId}
                className={`relative rounded-2xl border bg-background/40 overflow-hidden transition-all ${
                  d.selected && !d.alreadyImported
                    ? "border-primary/60 shadow-glow"
                    : d.alreadyImported
                      ? "border-muted-foreground/30 opacity-60"
                      : "border-border"
                }`}
              >
                <button
                  onClick={() => {
                    if (!d.alreadyImported) updateDraft(d.epornerId, { selected: !d.selected });
                  }}
                  disabled={d.alreadyImported}
                  className={`absolute top-2 left-2 z-10 h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                    d.selected && !d.alreadyImported
                      ? "gradient-primary text-primary-foreground shadow-glow"
                      : "bg-black/60 text-foreground/70"
                  } ${d.alreadyImported ? "cursor-not-allowed" : ""}`}
                >
                  <Check className="h-4 w-4" />
                </button>
                {d.alreadyImported && (
                  <div className="absolute top-2 right-2 z-10 bg-black/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Already imported
                  </div>
                )}
                <img
                  src={d.thumbnail}
                  alt={d.title}
                  className="w-full aspect-video object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://placehold.co/640x360/1a1a2e/white?text=No+Thumbnail";
                  }}
                />
                <div className="p-3 space-y-2">
          <input
            value={d.title}
            onChange={(e) => updateDraft(d.epornerId, { title: e.target.value.slice(0, 120) })}
            maxLength={120}
            className="w-full bg-secondary/40 rounded-md px-2 py-1.5 text-sm font-semibold outline-none focus:bg-background focus:shadow-glow"
            disabled={d.alreadyImported}
          />
                  <div className="flex items-center gap-1">
                    <input
                      value={d.slug}
                      onChange={(e) =>
                        updateDraft(d.epornerId, { autoSlug: false, slug: slugify(e.target.value) })
                      }
                      placeholder="slug"
                      className="flex-1 bg-secondary/40 rounded-md px-2 py-1 text-xs font-mono outline-none focus:bg-background"
                      disabled={d.alreadyImported}
                    />
                    <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer pl-1">
                      <input
                        type="checkbox"
                        checked={d.autoSlug}
                        onChange={(e) => {
                          const on = e.target.checked;
                          updateDraft(d.epornerId, {
                            autoSlug: on,
                            slug: on ? slugify(d.title) : d.slug,
                          });
                        }}
                        disabled={d.alreadyImported}
                      />{" "}
                      auto
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={d.channel}
                      onChange={(e) => updateDraft(d.epornerId, { channel: e.target.value })}
                      placeholder="Channel"
                      className="bg-secondary/40 rounded-md px-2 py-1 text-xs outline-none focus:bg-background"
                      disabled={d.alreadyImported}
                    />
                    <input
                      value={d.duration}
                      onChange={(e) => updateDraft(d.epornerId, { duration: e.target.value })}
                      placeholder="Duration"
                      className="bg-secondary/40 rounded-md px-2 py-1 text-xs outline-none focus:bg-background"
                      disabled={d.alreadyImported}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground px-1">
                    <span>&#x1F441;&#xFE0F; {d.views.toLocaleString()} views</span>
                    <span>&#x2B50; {d.rating} /5</span>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground/70 mb-0.5 px-0.5">
                      Category <span className="text-primary/70">(AI selected)</span>
                    </p>
                    <select
                      value={d.category}
                      onChange={(e) => updateDraft(d.epornerId, { category: e.target.value })}
                      className="w-full bg-secondary/40 rounded-md px-2 py-1.5 text-xs outline-none focus:bg-background"
                      disabled={d.alreadyImported}
                    >
                      {availableCategories.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.icon} {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={d.tags}
                    onChange={(e) => updateDraft(d.epornerId, { tags: e.target.value })}
                    placeholder="tags, comma, separated"
                    className="w-full bg-secondary/40 rounded-md px-2 py-1.5 text-xs outline-none focus:bg-background"
                    disabled={d.alreadyImported}
                  />
                  <div className="relative">
                    <textarea
                      value={d.description}
                      onChange={(e) =>
                        updateDraft(d.epornerId, { description: e.target.value.slice(0, 600) })
                      }
                      placeholder="Description (max 600 chars)"
                      rows={2}
                      className="w-full bg-secondary/40 rounded-md px-2 py-1.5 text-xs outline-none focus:bg-background"
                      disabled={d.alreadyImported}
                      maxLength={600}
                    />
                    <span
                      className={`absolute bottom-1.5 right-2 text-[10px] ${d.description.length >= 550 ? "text-yellow-400" : "text-muted-foreground/50"}`}
                    >
                      {d.description.length}/600
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => updateDraft(d.epornerId, { featured: !d.featured })}
                      aria-pressed={d.featured}
                      disabled={d.alreadyImported}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                        d.featured && !d.alreadyImported
                          ? "gradient-primary text-primary-foreground shadow-glow"
                          : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
                      } ${d.alreadyImported ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Star className="h-3 w-3" /> Featured: {d.featured ? "ON" : "OFF"}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDraft(d.epornerId, { trending: !d.trending })}
                      aria-pressed={d.trending}
                      disabled={d.alreadyImported}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
                        d.trending && !d.alreadyImported
                          ? "gradient-primary text-primary-foreground shadow-glow"
                          : "bg-secondary/60 text-muted-foreground hover:bg-secondary"
                      } ${d.alreadyImported ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Flame className="h-3 w-3" /> Trending: {d.trending ? "ON" : "OFF"}
                    </button>
                  </div>
                  <button
                    onClick={() => removeDraft(d.epornerId)}
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                    disabled={d.alreadyImported}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <button
                onClick={() => changePage(currentPage - 1)}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/50 px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => changePage(pageNum)}
                      className={`rounded-full w-8 h-8 text-sm transition-all ${currentPage === pageNum ? "gradient-primary text-primary-foreground shadow-glow" : "bg-secondary/50 hover:bg-secondary"}`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => changePage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1 rounded-full bg-secondary/50 px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

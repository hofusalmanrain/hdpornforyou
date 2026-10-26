import {
  Trash2,
  Save,
  LogOut,
  Shield,
  Palette,
  Type,
  Megaphone,
  Video as VideoIcon,
  KeyRound,
  Search as SearchIcon,
  RefreshCw,
  Pencil,
  Check,
  Upload,
  MessageSquare,
  BarChart3,
  Activity,
  ImageOff,
  Layers,
  Zap,
  Eye,
  EyeOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { removeVideo, upsertVideo, getAllVideos, adjustVideo } from "@/lib/video-store";
import {
  getSettings as getAutoSettings,
  saveSettings as saveAutoSettings,
} from "@/lib/auto-import-store";
import { useVideos } from "@/hooks/use-videos";
import { formatViews, getEmbedId, type Video } from "@/data/videos";
import { useCategories } from "@/hooks/use-categories";
import { CategoriesEditor } from "@/components/admin/CategoriesEditor";
import {
  adminLogin,
  adminLogout,
  getAdminUsername,
  updateAdminCredentials,
} from "@/lib/auth-store";
import { useAuth } from "@/hooks/use-auth";
import { useLabels } from "@/hooks/use-labels";
import { ThemeEditor } from "@/components/admin/ThemeEditor";
import { LabelsEditor } from "@/components/admin/LabelsEditor";
import { AdsEditor, bootAdsConfig } from "@/components/admin/AdsEditor";
import { VideoImporter } from "@/components/admin/VideoImporter";
import { AutoImporter } from "@/components/admin/AutoImporter";
import { CommentsModerator } from "@/components/admin/CommentsModerator";
import { AdsStats } from "@/components/admin/AdsStats";
import { LiveTraffic } from "@/components/admin/LiveTraffic";
import { getSeo, setSeo, resetSeo, SEO_EVENT, type SeoSettings } from "@/lib/seo-store";
import { COMMENTS_EVENT, isCommentsDisabled, setCommentsDisabled } from "@/lib/comments-store";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

type Tab =
  | "catalog"
  | "importer"
  | "automation"
  | "categories"
  | "comments"
  | "theme"
  | "labels"
  | "ads"
  | "stats"
  | "live"
  | "seo"
  | "credentials";

export default function AdminPage() {
  const { admin, ready } = useAuth();
  const labels = useLabels();
  const [tab, setTab] = useState<Tab>("catalog");

  useEffect(() => {
    bootAdsConfig();
  }, []);

  if (!ready) return <AdminLoading />;
  if (!admin) return <AdminGate />;

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-7xl mx-auto px-4 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              <span className="text-gradient">{labels.adminTitle}</span>
            </h1>
            <p className="text-muted-foreground mt-1">Manage every aspect of your site.</p>
          </div>
          <button
            onClick={adminLogout}
            className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm font-semibold hover:bg-secondary"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <nav className="mt-6 flex gap-2 overflow-x-auto whitespace-nowrap pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
          <TabBtn
            active={tab === "catalog"}
            onClick={() => setTab("catalog")}
            icon={<VideoIcon className="h-4 w-4" />}
          >
            Catalog
          </TabBtn>
          <TabBtn
            active={tab === "importer"}
            onClick={() => setTab("importer")}
            icon={<Upload className="h-4 w-4" />}
          >
            Importer
          </TabBtn>
          <TabBtn
            active={tab === "automation"}
            onClick={() => setTab("automation")}
            icon={<Zap className="h-4 w-4" />}
          >
            Automation
          </TabBtn>
          <TabBtn
            active={tab === "categories"}
            onClick={() => setTab("categories")}
            icon={<Layers className="h-4 w-4" />}
          >
            Categories
          </TabBtn>
          <TabBtn
            active={tab === "comments"}
            onClick={() => setTab("comments")}
            icon={<MessageSquare className="h-4 w-4" />}
          >
            Comments
          </TabBtn>
          <TabBtn
            active={tab === "ads"}
            onClick={() => setTab("ads")}
            icon={<Megaphone className="h-4 w-4" />}
          >
            Ads &amp; VAST
          </TabBtn>
          <TabBtn
            active={tab === "stats"}
            onClick={() => setTab("stats")}
            icon={<BarChart3 className="h-4 w-4" />}
          >
            Performance
          </TabBtn>
          <TabBtn
            active={tab === "live"}
            onClick={() => setTab("live")}
            icon={<Activity className="h-4 w-4" />}
          >
            Live traffic
          </TabBtn>
          <TabBtn
            active={tab === "seo"}
            onClick={() => setTab("seo")}
            icon={<SearchIcon className="h-4 w-4" />}
          >
            SEO
          </TabBtn>
          <TabBtn
            active={tab === "theme"}
            onClick={() => setTab("theme")}
            icon={<Palette className="h-4 w-4" />}
          >
            Theme
          </TabBtn>
          <TabBtn
            active={tab === "labels"}
            onClick={() => setTab("labels")}
            icon={<Type className="h-4 w-4" />}
          >
            Labels
          </TabBtn>
          <TabBtn
            active={tab === "credentials"}
            onClick={() => setTab("credentials")}
            icon={<KeyRound className="h-4 w-4" />}
          >
            Account
          </TabBtn>
        </nav>

        <div className="mt-6">
          {tab === "catalog" && <CatalogTab />}
          {tab === "importer" && <VideoImporter />}
          {tab === "automation" && <AutoImporter />}
          {tab === "categories" && <CategoriesEditor />}
          {tab === "comments" && <CommentsModerator />}
          {tab === "theme" && <ThemeEditor />}
          {tab === "labels" && <LabelsEditor />}
          {tab === "ads" && <AdsEditor />}
          {tab === "stats" && <AdsStats />}
          {tab === "live" && <LiveTraffic />}
          {tab === "seo" && <SeoTab />}
          {tab === "credentials" && <CredentialsTab />}
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

function AdminLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="rounded-2xl gradient-card p-8 shadow-card text-center">
        <p className="text-sm text-muted-foreground">Checking admin session…</p>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${active ? "gradient-primary text-primary-foreground shadow-glow" : "glass hover:bg-secondary"}`}
    >
      {icon} {children}
    </button>
  );
}

/* ---------------------------- Admin login gate ---------------------------- */

function AdminGate() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    const ok = await adminLogin(u, p);
    if (!ok) setErr("Invalid administrator credentials.");
  };
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl gradient-card p-8 shadow-card animate-fade-up"
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Admin access</h1>
            <p className="text-xs text-muted-foreground">Staff only — restricted area</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <Field label="Username" value={u} onChange={setU} />
          <Field label="Password" type="password" value={p} onChange={setP} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <button className="w-full rounded-full gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-[1.01] transition-transform">
            Enter dashboard
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------- Catalog ---------------------------- */

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function CatalogTab() {
  const videos = useVideos();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Video | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [thumbnailAutoClean, setThumbnailAutoClean] = useState(false);

  useEffect(() => {
    getAutoSettings()
      .then((s) => setThumbnailAutoClean(s.thumbnailAutoClean))
      .catch(() => {});
  }, []);

  const toggleThumbnailAutoClean = async () => {
    const next = !thumbnailAutoClean;
    setThumbnailAutoClean(next);
    try {
      await saveAutoSettings({ thumbnailAutoClean: next });
    } catch {
      setThumbnailAutoClean(!next);
    }
  };

  const cleanupDeadThumbnails = async () => {
    if (cleaning) return;
    if (
      !confirm(
        "Scan the entire catalog and remove every video whose thumbnail is missing or fails to load?\n\n" +
          "This cannot be undone.",
      )
    )
      return;
    setCleaning(true);
    setCleanMsg(`Scanning thumbnails… 0 / ${videos.length}`);

    const checkThumb = (url: string): Promise<boolean> =>
      new Promise((resolve) => {
        if (!url || !url.trim()) return resolve(false);
        const img = new Image();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          resolve(ok);
        };
        img.onload = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          // Reject tiny/placeholder images
          if (w < 100 || h < 80) return finish(false);
          return finish(true);
        };
        img.onerror = () => finish(false);
        // 10s timeout — slow CDN shouldn't get nuked
        setTimeout(() => finish(false), 10000);
        img.src = url;
      });

    const dead: Video[] = [];
    // Run in parallel batches of 8 to keep the browser responsive.
    const batchSize = 8;
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      const results = await Promise.all(batch.map((v) => checkThumb(v.thumbnail)));
      results.forEach((ok, j) => {
        if (!ok) dead.push(batch[j]);
      });
      setCleanMsg(
        `Scanning thumbnails… ${Math.min(i + batchSize, videos.length)} / ${videos.length}`,
      );
    }

    if (!dead.length) {
      setCleanMsg("All thumbnails are healthy. Nothing to remove.");
      setCleaning(false);
      return;
    }

    setCleanMsg(
      `Removing ${dead.length} video${dead.length === 1 ? "" : "s"} with dead thumbnails…`,
    );
    for (const v of dead) {
      try {
        await removeVideo(v.id);
      } catch {
        /* keep going */
      }
    }
    setCleanMsg(
      `Removed ${dead.length} video${dead.length === 1 ? "" : "s"} with dead or missing thumbnails.`,
    );
    setCleaning(false);
  };

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return videos;
    return videos.filter(
      (v) =>
        v.title.toLowerCase().includes(needle) ||
        v.id.toLowerCase().includes(needle) ||
        (v.slug ?? "").toLowerCase().includes(needle) ||
        v.category.toLowerCase().includes(needle) ||
        v.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [videos, q]);

  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected);
      filtered.forEach((v) => next.delete(v.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((v) => next.add(v.id));
      setSelected(next);
    }
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const confirmBulkDelete = () => {
    selected.forEach((id) => removeVideo(id));
    setSelected(new Set());
    setReviewOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total videos" value={videos.length} />
        <Stat label="Trending" value={videos.filter((v) => v.trending).length} />
        <Stat label="Featured" value={videos.filter((v) => v.featured).length} />
        <Stat label="Categories" value={new Set(videos.map((v) => v.category)).size} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, slug, ID, category or tag…"
            className="w-full rounded-full bg-background border border-border focus:border-primary/60 pl-10 pr-4 py-2.5 text-sm outline-none focus:shadow-glow"
          />
        </div>
        {selected.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <button
              onClick={() => setReviewOpen(true)}
              className="inline-flex items-center gap-2 rounded-full bg-destructive/20 text-destructive px-4 py-2 text-sm font-semibold hover:bg-destructive/30"
            >
              <Trash2 className="h-4 w-4" /> Review &amp; delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
            >
              Clear
            </button>
          </>
        )}
        <button
          onClick={cleanupDeadThumbnails}
          disabled={cleaning || videos.length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-destructive/15 text-destructive px-4 py-2 text-sm font-semibold hover:bg-destructive/25 disabled:opacity-40"
          title="Scan and remove every video with a missing or broken thumbnail"
        >
          <ImageOff className="h-4 w-4" />
          {cleaning ? "Cleaning…" : "Clean up dead thumbnails"}
        </button>
        <button
          onClick={toggleThumbnailAutoClean}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
            thumbnailAutoClean
              ? "gradient-primary text-primary-foreground shadow-glow"
              : "glass hover:bg-secondary"
          }`}
          title="Auto-clean dead thumbnails every day at 01:35 Nepal time"
        >
          <RefreshCw className="h-4 w-4" />
          Auto-clean 24h: {thumbnailAutoClean ? "ON" : "OFF"}
        </button>
      </div>
      {cleanMsg && <p className="text-xs text-muted-foreground">{cleanMsg}</p>}

      <section>
        <div className="rounded-2xl gradient-card shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-3 w-10">
                    <button
                      onClick={toggleAll}
                      className={`h-5 w-5 rounded border flex items-center justify-center ${allSelected ? "gradient-primary border-transparent text-primary-foreground" : "border-border"}`}
                    >
                      {allSelected && <Check className="h-3 w-3" />}
                    </button>
                  </th>
                  <th className="text-left p-3">Video</th>
                  <th className="text-left p-3 hidden sm:table-cell">Category</th>
                  <th className="text-left p-3 hidden md:table-cell">Views</th>
                  <th className="text-left p-3 hidden lg:table-cell">Flags</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      No videos match.
                    </td>
                  </tr>
                )}
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-border hover:bg-secondary/30 transition-colors"
                  >
                    <td className="p-3">
                      <button
                        onClick={() => toggle(v.id)}
                        className={`h-5 w-5 rounded border flex items-center justify-center ${selected.has(v.id) ? "gradient-primary border-transparent text-primary-foreground" : "border-border"}`}
                      >
                        {selected.has(v.id) && <Check className="h-3 w-3" />}
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={v.thumbnail}
                          alt=""
                          className="h-12 w-20 object-cover rounded-md"
                        />
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-xs">{v.title}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-xs">
                            {v.slug ?? v.id}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 capitalize hidden sm:table-cell">{v.category}</td>
                    <td className="p-3 tabular-nums hidden md:table-cell">
                      {formatViews(v.views)}
                    </td>
                    <td className="p-3 space-x-1 hidden lg:table-cell">
                      {v.trending && (
                        <span className="rounded-full gradient-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                          TR
                        </span>
                      )}
                      {v.featured && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
                          FT
                        </span>
                      )}
                      {v.hd && (
                        <span className="rounded-full glass px-2 py-0.5 text-[10px] font-bold">
                          HD
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right flex flex-col sm:flex-row items-end sm:items-center justify-end gap-2 sm:gap-1">
                      <button
                        onClick={() => setEditing(v)}
                        className="rounded-md glass px-3 py-1 text-xs hover:bg-secondary inline-flex items-center justify-center gap-1 w-20 sm:w-auto"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${v.title}"?`)) removeVideo(v.id);
                        }}
                        className="rounded-md bg-destructive/20 text-destructive px-3 py-1 text-xs hover:bg-destructive/30 inline-flex items-center justify-center gap-1 w-20 sm:w-auto border border-transparent"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {editing && (
        <EditVideoModal
          video={editing}
          onClose={() => setEditing(null)}
          onSave={async (v, deltas) => {
            await upsertVideo(v);
            if (deltas.addViews || deltas.addLikes) {
              await adjustVideo(v.id, deltas.addViews, deltas.addLikes);
            }
            setEditing(null);
          }}
        />
      )}

      {reviewOpen && (
        <ReviewDeleteModal
          videos={videos.filter((v) => selected.has(v.id))}
          onCancel={() => setReviewOpen(false)}
          onConfirm={confirmBulkDelete}
        />
      )}
    </div>
  );
}

function ReviewDeleteModal({
  videos,
  onCancel,
  onConfirm,
}: {
  videos: Video[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Review videos before deletion"
    >
      <div className="w-full max-w-2xl rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-destructive" /> Review {videos.length} video
          {videos.length === 1 ? "" : "s"} before deletion
        </h3>
        <p className="text-sm text-muted-foreground">
          This action is permanent. Confirm the list below.
        </p>
        <ul className="max-h-80 overflow-y-auto divide-y divide-border rounded-xl bg-background/40">
          {videos.map((v) => (
            <li key={v.id} className="p-3 flex items-center gap-3 text-sm">
              <img src={v.thumbnail} alt="" className="h-10 w-16 object-cover rounded" />
              <div className="min-w-0">
                <p className="font-medium truncate">{v.title}</p>
                <p className="text-xs text-muted-foreground truncate">{v.id}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-destructive text-destructive-foreground px-4 py-2 text-sm font-semibold hover:bg-destructive/90"
          >
            Delete {videos.length}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditVideoModal({
  video,
  onClose,
  onSave,
}: {
  video: Video;
  onClose: () => void;
  onSave: (v: Video, deltas: { addViews: number; addLikes: number }) => void;
}) {
  // Keep the modal's "live" view of this video in sync with the global cache
  // so that admin actions (Apply +/−) immediately reflect the new totals.
  const allVideos = useVideos();
  const categories = useCategories();
  // liveVideo tracks the authoritative server values after each Apply +/−.
  // Initialized from the prop; updated directly from the adjust API response.
  const [liveVideo, setLiveVideo] = useState<Video>(video);
  // Use liveVideo as the display source — don't sync from allVideos (which can
  // lag or overwrite with stale values during background hydration).
  const live = liveVideo;

  const [draft, setDraft] = useState<Video>(video);
  const [autoSlug, setAutoSlug] = useState(true);

  const [tagInput, setTagInput] = useState(video.tags.join(", "));
  const [disabled, setDisabled] = useState(isCommentsDisabled(video.id));
  // The comments-disabled flag hydrates asynchronously from the server. Re-read
  // it once hydration completes (fires COMMENTS_EVENT) so the toggle reflects
  // the actual stored value rather than the initial `false` default.
  useEffect(() => {
    const sync = () => setDisabled(isCommentsDisabled(video.id));
    sync();
    window.addEventListener(COMMENTS_EVENT, sync);
    return () => window.removeEventListener(COMMENTS_EVENT, sync);
  }, [video.id]);
  const [addViews, setAddViews] = useState("");
  const [addLikes, setAddLikes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const set = <K extends keyof Video>(k: K, v: Video[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (autoSlug) setDraft((d) => ({ ...d, slug: slugify(d.title) }));
  }, [draft.title, autoSlug]);

  // Format with the international (US) number system: 1,000,000 — never the
  // South-Asian system (10,00,000) that the browser would pick if the user
  // were running in an Indian locale.
  const intl = (n: number) => Number(n || 0).toLocaleString("en-US");

  /**
   * Parse a delta like "1m", "-500k", "1.5b" or "200000" into an integer.
   * Empty string and lone +/- mean zero. Friendly suffixes (k/m/b) are
   * supported so admins don't have to type long zero strings.
   */
  const parseDelta = (s: string) => {
    const t = s.trim().toLowerCase();
    if (!t || t === "-" || t === "+") return 0;
    const m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*([kmb]?)$/);
    if (!m) return 0;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return 0;
    const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : m[2] === "b" ? 1_000_000_000 : 1;
    return Math.trunc(n * mult);
  };

  // Apply the +/− deltas alone (without closing the modal) so the admin can
  // see the updated totals immediately and keep editing.
  const applyDeltas = async () => {
    const dv = parseDelta(addViews);
    const dl = parseDelta(addLikes);
    if (!dv && !dl) return;
    setApplying(true);
    try {
      const updated = await adjustVideo(video.id, dv, dl);
      if (updated) setLiveVideo(updated);
      setAddViews("");
      setAddLikes("");
    } finally {
      setApplying(false);
    }
  };

  const save = () => {
    if (!draft.title.trim()) {
      setErr("Title is required.");
      return;
    }
    const desiredSlug = draft.slug?.trim() || slugify(draft.title);
    // Uniqueness is enforced by embed id (e.g. YouTube video id), NOT by slug.
    // Two videos can share a slug, but the embed id must be unique.
    const desiredEmbedId = getEmbedId(draft);
    const clash = getAllVideos().find((v) => v.id !== draft.id && getEmbedId(v) === desiredEmbedId);
    if (clash) {
      setErr(`Embed id "${desiredEmbedId}" is already used by "${clash.title}".`);
      return;
    }
    setCommentsDisabled(video.id, disabled);
    onSave(
      {
        ...draft,
        slug: desiredSlug,
        tags: tagInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      },
      { addViews: parseDelta(addViews), addLikes: parseDelta(addLikes) },
    );
  };

  return (
    <div
      className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit video"
    >
      <div className="w-full max-w-3xl max-h-[95dvh] flex flex-col rounded-2xl gradient-card shadow-card">
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1 min-h-0">
          <h3 className="font-display text-xl font-bold flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" /> Edit video
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Title"
              value={draft.title}
              onChange={(v) => set("title", v)}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2 flex items-end gap-2">
              <Field
                label="Slug"
                value={draft.slug ?? ""}
                onChange={(v) => {
                  setAutoSlug(false);
                  set("slug", slugify(v));
                }}
                className="flex-1"
              />
              <label className="inline-flex items-center gap-2 text-xs pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSlug}
                  onChange={(e) => setAutoSlug(e.target.checked)}
                />
                Auto from title
              </label>
            </div>
            <Field
              label="Embed URL"
              value={draft.embedUrl}
              onChange={(v) => set("embedUrl", v)}
              className="sm:col-span-2"
            />
            <Field
              label="Thumbnail URL"
              value={draft.thumbnail}
              onChange={(v) => set("thumbnail", v)}
              className="sm:col-span-2"
            />
            <Field
              label="Publish date"
              type="date"
              value={draft.uploadedAt}
              onChange={(v) => set("uploadedAt", v)}
            />
            <Field label="Channel" value={draft.channel} onChange={(v) => set("channel", v)} />
            <Field
              label="Duration"
              value={draft.duration}
              onChange={(v) => set("duration", v)}
              placeholder="12:34"
            />
            <SelectField
              label="Category"
              value={draft.category}
              onChange={(v) => set("category", v)}
              options={categories
                .filter((c) => c.slug !== "all")
                .map((c) => ({ value: c.slug, label: c.name }))}
            />
            <Field
              label="Tags (comma separated)"
              value={tagInput}
              onChange={setTagInput}
              className="sm:col-span-2"
            />

            <div className="sm:col-span-2 rounded-xl bg-secondary/40 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Views
                  </p>
                  <p className="font-display text-lg font-bold tabular-nums">
                    {formatViews(live.views)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({intl(live.views)})
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Likes
                  </p>
                  <p className="font-display text-lg font-bold tabular-nums">
                    {formatViews(live.likes)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({intl(live.likes)})
                    </span>
                  </p>
                </div>
                <Field
                  label="Adjust views (+/−, accepts 1k/1m/1b)"
                  type="text"
                  value={addViews}
                  onChange={(v) => setAddViews(v)}
                  placeholder="e.g. 400000, -50000, 1.5m"
                />
                <Field
                  label="Adjust likes (+/−, accepts 1k/1m/1b)"
                  type="text"
                  value={addLikes}
                  onChange={(v) => setAddLikes(v)}
                  placeholder="e.g. 1m or -250k"
                />
              </div>
              <button
                type="button"
                onClick={applyDeltas}
                disabled={applying || (!parseDelta(addViews) && !parseDelta(addLikes))}
                className="inline-flex items-center gap-2 rounded-full bg-primary/20 text-primary px-4 py-2 text-xs font-semibold hover:bg-primary/30 disabled:opacity-40"
              >
                {applying ? "Applying…" : "Apply +/− now"}
              </button>
              <p className="text-[11px] text-muted-foreground">
                Tip: "Apply +/− now" updates the totals instantly so you can see the new numbers
                before closing.
              </p>
            </div>

            <TextArea
              label="Description"
              value={draft.description}
              onChange={(v) => set("description", v)}
              className="sm:col-span-2"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Toggle label="HD" checked={!!draft.hd} onChange={(v) => set("hd", v)} />
            <Toggle
              label="Featured"
              checked={!!draft.featured}
              onChange={(v) => set("featured", v)}
            />
            <Toggle
              label="Trending"
              checked={!!draft.trending}
              onChange={(v) => set("trending", v)}
            />
            <Toggle label="Disable comments" checked={disabled} onChange={setDisabled} />
            <span className="text-[11px] text-muted-foreground basis-full">
              The engagement algorithm (views/day + likes ratio) auto-promotes videos into Trending
              and Featured. Toggling these flags ON pins the video into the list regardless of
              score; OFF lets the algorithm decide.
            </span>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        <div className="shrink-0 border-t border-border/50 p-4 sm:px-6 sm:py-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="inline-flex items-center gap-2 rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform"
          >
            <Save className="h-4 w-4" /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl gradient-card p-5 shadow-card">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-gradient">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  const [showPw, setShowPw] = useState(false);
  const isPw = type === "password";
  return (
    <label className={`block ${className}`}>
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={isPw && showPw ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow ${isPw ? "pr-10" : ""}`}
        />
        {isPw && (
          <button
            type="button"
            aria-label={showPw ? "Hide password" : "Show password"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              const input = e.currentTarget.parentElement?.querySelector("input");
              const start = input?.selectionStart ?? null;
              const end = input?.selectionEnd ?? null;
              setShowPw((v) => !v);
              requestAnimationFrame(() => {
                if (!input) return;
                input.focus({ preventScroll: true });
                try {
                  if (start !== null && end !== null) input.setSelectionRange(start, end);
                } catch {}
              });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span className="h-5 w-9 rounded-full bg-secondary relative peer-checked:gradient-primary transition-all after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-foreground after:transition-all peer-checked:after:translate-x-4" />
      <span className="text-sm">{label}</span>
    </label>
  );
}

/* ---------------------------- SEO ---------------------------- */

interface PublicFile {
  name: string;
  size: number;
  mtime: string;
}

function PublicFileUploader() {
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get<{ files: PublicFile[] }>("/api/seo/files")
      .then(({ files }) => setFiles(files))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const uploadFile = (file: File) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const content = reader.result as string;
        await api.post("/api/seo/upload", { filename: file.name, content });
        toast.success(`Uploaded ${file.name}`);
        load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      toast.error("Could not read file");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const remove = async (name: string) => {
    try {
      await api.del(`/api/seo/files/${encodeURIComponent(name)}`);
      setFiles((prev) => prev.filter((f) => f.name !== name));
      toast.success(`Deleted ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
      <h3 className="font-display text-lg font-bold flex items-center gap-2">
        <Upload className="h-5 w-5 text-primary" /> Public file uploads
      </h3>
      <p className="text-sm text-muted-foreground">
        Upload files (HTML, JS, CSS, images, etc.) to the public folder. They are immediately
        accessible at <code className="text-foreground">domain.com/filename</code> — no rebuild
        needed.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
        }`}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {uploading ? "Uploading…" : "Drag & drop a file here, or"}
        </p>
        {!uploading && (
          <label className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm font-semibold hover:bg-secondary cursor-pointer">
            <Upload className="h-4 w-4" /> Browse files
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadFile(file);
                e.target.value = "";
              }}
            />
          </label>
        )}
        <p className="text-[10px] text-muted-foreground">
          Max 10 MB — HTML, JS, CSS, images, text, etc.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-3 rounded-lg bg-background/40 border border-border px-3 py-2"
            >
              <span className="text-sm font-medium truncate flex-1">{f.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatSize(f.size)}</span>
              <a
                href={`/${encodeURIComponent(f.name)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline shrink-0"
              >
                View
              </a>
              <button
                onClick={() => remove(f.name)}
                className="text-destructive hover:bg-destructive/10 rounded-full p-1 shrink-0"
                aria-label={`Delete ${f.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SeoTab() {
  const [seo, setLocal] = useState<SeoSettings>(() => getSeo());
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setLocal(getSeo());
    sync();
    window.addEventListener(SEO_EVENT, sync);
    return () => window.removeEventListener(SEO_EVENT, sync);
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setSeo(seo);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      await resetSeo();
      setLocal(getSeo());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message || "Failed to reset");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h2 className="font-display text-xl font-bold flex items-center gap-2">
          <SearchIcon className="h-5 w-5 text-primary" /> Global SEO
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Site title"
            value={seo.title}
            onChange={(v) => setLocal({ ...seo, title: v })}
            className="sm:col-span-2"
          />
          <TextArea
            label="Meta description"
            value={seo.description}
            onChange={(v) => setLocal({ ...seo, description: v })}
            className="sm:col-span-2"
          />
          <Field
            label="Canonical base URL"
            value={seo.canonicalBase}
            onChange={(v) => setLocal({ ...seo, canonicalBase: v })}
            placeholder="https://example.com"
          />
          <SelectField
            label="Robots meta"
            value={seo.robots}
            onChange={(v) => setLocal({ ...seo, robots: v })}
            options={[
              { value: "index, follow", label: "index, follow" },
              { value: "noindex, follow", label: "noindex, follow" },
              { value: "index, nofollow", label: "index, nofollow" },
              { value: "noindex, nofollow", label: "noindex, nofollow" },
            ]}
          />
        </div>
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">Open Graph</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="og:type"
            value={seo.og.type}
            onChange={(v) => setLocal({ ...seo, og: { ...seo.og, type: v } })}
          />
          <Field
            label="og:site_name"
            value={seo.og.siteName}
            onChange={(v) => setLocal({ ...seo, og: { ...seo.og, siteName: v } })}
          />
          <Field
            label="og:image URL"
            value={seo.og.image}
            onChange={(v) => setLocal({ ...seo, og: { ...seo.og, image: v } })}
            className="sm:col-span-2"
          />
          <Field
            label="og:image:alt"
            value={seo.og.imageAlt}
            onChange={(v) => setLocal({ ...seo, og: { ...seo.og, imageAlt: v } })}
            className="sm:col-span-2"
          />
        </div>
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">Twitter Card</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField
            label="twitter:card"
            value={seo.twitter.card}
            onChange={(v) =>
              setLocal({
                ...seo,
                twitter: { ...seo.twitter, card: v as SeoSettings["twitter"]["card"] },
              })
            }
            options={[
              { value: "summary", label: "summary" },
              { value: "summary_large_image", label: "summary_large_image" },
              { value: "player", label: "player" },
              { value: "app", label: "app" },
            ]}
          />
          <Field
            label="twitter:site"
            value={seo.twitter.site}
            onChange={(v) => setLocal({ ...seo, twitter: { ...seo.twitter, site: v } })}
            placeholder="@yoursite"
          />
          <Field
            label="twitter:creator"
            value={seo.twitter.creator}
            onChange={(v) => setLocal({ ...seo, twitter: { ...seo.twitter, creator: v } })}
          />
          <Field
            label="twitter:image URL"
            value={seo.twitter.image}
            onChange={(v) => setLocal({ ...seo, twitter: { ...seo.twitter, image: v } })}
          />
        </div>
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">robots.txt</h3>
        <textarea
          value={seo.robotsTxt}
          onChange={(e) => setLocal({ ...seo, robotsTxt: e.target.value })}
          rows={6}
          className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
        />
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">ads.txt</h3>
        <textarea
          value={seo.adsTxt}
          onChange={(e) => setLocal({ ...seo, adsTxt: e.target.value })}
          rows={6}
          className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
        />
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-3">
        <h3 className="font-display text-lg font-bold">Custom code injection</h3>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Injected into &lt;head&gt;
          </span>
          <textarea
            value={seo.customHead}
            onChange={(e) => setLocal({ ...seo, customHead: e.target.value })}
            rows={5}
            className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Injected before &lt;/body&gt;
          </span>
          <textarea
            value={seo.customBody}
            onChange={(e) => setLocal({ ...seo, customBody: e.target.value })}
            rows={5}
            className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono"
          />
        </label>
      </section>

      <PublicFileUploader />

      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-50"
        >
          <Save className="h-4 w-4" />{" "}
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save all SEO settings"}
        </button>
        {error && <span className="text-sm text-destructive">{error}</span>}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full glass px-4 py-2.5 text-sm hover:bg-secondary"
        >
          <RefreshCw className="h-4 w-4" /> Reset to defaults
        </button>
        <a
          href="/sitemap.xml"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full glass px-4 py-2.5 text-sm hover:bg-secondary"
        >
          View sitemap
        </a>
      </div>
    </div>
  );
}

/* ---------------------------- Account ---------------------------- */

function CredentialsTab() {
  const [currentPw, setCurrentPw] = useState("");
  const [newU, setNewU] = useState(getAdminUsername());
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (newPw !== confirmPw) {
      setFeedback({ ok: false, msg: "New passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      const res = await updateAdminCredentials(currentPw, newU, newPw);
      if (!res.ok) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setFeedback({ ok: true, msg: "Credentials updated. Use them on next sign-in." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl gradient-card p-6 shadow-card max-w-xl">
      <h2 className="font-display text-xl font-bold flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" /> Admin account
      </h2>
      <p className="text-sm text-muted-foreground mt-1">
        Username and password used to access this dashboard. Stored hashed in the local application
        database (no external auth service).
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <Field label="Current password" type="password" value={currentPw} onChange={setCurrentPw} />
        <Field label="New username" value={newU} onChange={setNewU} />
        <Field label="New password" type="password" value={newPw} onChange={setNewPw} />
        <Field
          label="Confirm new password"
          type="password"
          value={confirmPw}
          onChange={setConfirmPw}
        />
        {feedback && (
          <p className={`text-sm ${feedback.ok ? "text-primary" : "text-destructive"}`}>
            {feedback.msg}
          </p>
        )}
        <button
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-4 w-4" /> {saving ? "Updating…" : "Update credentials"}
        </button>
      </form>
    </section>
  );
}

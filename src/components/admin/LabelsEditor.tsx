import { useState, useEffect, useCallback } from "react";
import { Type, RotateCcw, Upload, X, ImageIcon, Image as ImageLogo } from "lucide-react";
import { DEFAULT_LABELS, type LabelKey, resetLabels, setLabels } from "@/lib/labels-store";
import { useLabels } from "@/hooks/use-labels";
import { api } from "@/lib/api-client";

const FIELDS: { key: LabelKey; label: string; hint?: string }[] = [
  { key: "brandName", label: "Brand name", hint: "Logo & navbar title" },
  { key: "brandTagline", label: "Brand tagline" },
  { key: "heroBadge", label: "Hero badge" },
  { key: "heroCtaPlay", label: "Hero — Play button" },
  { key: "heroCtaInfo", label: "Hero — Details button" },
  { key: "featuredTitle", label: "Featured row title" },
  { key: "trendingTitle", label: "Trending row title" },
  { key: "latestTitle", label: "Latest videos title" },
  { key: "recommendedTitle", label: "Recommended title" },
  { key: "commentsTitle", label: "Watch — Comments title" },
  { key: "subscribeLabel", label: "Subscribe button" },
  { key: "footerTagline", label: "Footer tagline" },
  { key: "accountTitle", label: "Account page title" },
  { key: "accountSubtitle", label: "Account page subtitle" },
  { key: "adminTitle", label: "Admin page title" },
  {
    key: "contactEmail",
    label: "Contact email",
    hint: "Inbox for Contact & Careers forms (e.g. demo@gmail.com)",
  },
];

/** Shared image-upload picker used by both Favicon and Brand Logo. */
function ImagePicker({
  title,
  description,
  apiPath,
  icon,
  previewClass,
}: {
  title: string;
  description: string;
  apiPath: string;
  icon: React.ReactNode;
  previewClass: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    api
      .get<{ url: string | null }>(apiPath)
      .then(({ url }) => {
        setUrl(url);
        if (url) setUrlInput(url);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiPath]);

  const save = useCallback(
    async (imageUrl: string) => {
      setSaving(true);
      setError(null);
      try {
        const res = await api.put<{ ok: boolean; url: string }>(apiPath, { url: imageUrl });
        setUrl(res.url);
        setUrlInput(res.url);
        setPreviewKey((k) => k + 1);
      } catch (e: unknown) {
        setError(
          (e instanceof Error ? e.message : "Failed to save image") || "Failed to save image",
        );
      } finally {
        setSaving(false);
      }
    },
    [apiPath],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("File must be an image");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setError("Image must be under 2 MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => save(reader.result as string);
      reader.readAsDataURL(file);
    },
    [save],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleUrlSave = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    save(trimmed);
  }, [urlInput, save]);

  const remove = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.del(apiPath);
      setUrl(null);
      setUrlInput("");
      setPreviewKey((k) => k + 1);
    } catch (e: unknown) {
      setError(
        (e instanceof Error ? e.message : "Failed to remove image") || "Failed to remove image",
      );
    } finally {
      setSaving(false);
    }
  }, [apiPath]);

  if (loading) return null;

  return (
    <div className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
      <h3 className="font-display text-xl font-bold flex items-center gap-2">
        {icon} {title}
      </h3>
      <p className="text-sm text-muted-foreground">{description}</p>

      {url && (
        <div className="flex items-center gap-3">
          <img
            key={previewKey}
            src={url}
            alt={title}
            className={previewClass}
            style={{ objectFit: "contain" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {url.includes("/api/") ? "Uploaded image" : url}
          </span>
          <button
            onClick={remove}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-3 py-1.5 text-xs font-semibold hover:bg-destructive/20 disabled:opacity-40"
          >
            <X className="h-3 w-3" /> Remove
          </button>
        </div>
      )}

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
        <p className="text-sm text-muted-foreground">Drag & drop an image here, or</p>
        <label className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm font-semibold hover:bg-secondary cursor-pointer">
          <Upload className="h-4 w-4" /> Browse files
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-[10px] text-muted-foreground">PNG, JPG, SVG — max 2 MB</p>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Or paste an image URL..."
          className="flex-1 rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
        />
        <button
          onClick={handleUrlSave}
          disabled={saving || !urlInput.trim()}
          className="rounded-full glass px-4 py-2 text-sm font-semibold hover:bg-secondary disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save URL"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function LabelsEditor() {
  const labels = useLabels();
  return (
    <div className="space-y-6">
      <ImagePicker
        title="Brand logo"
        description="Upload a logo image for the navbar. When set, it replaces the first-letter badge in the navbar. When empty, the first letter of the brand name is used."
        apiPath="/api/brand-logo"
        icon={<ImageLogo className="h-5 w-5 text-primary" />}
        previewClass="h-10 w-10 rounded-lg border border-border bg-white"
      />
      <ImagePicker
        title="Favicon"
        description="Upload a square image (32×32 or 64×64 recommended). Shows in the browser tab."
        apiPath="/api/favicon"
        icon={<ImageIcon className="h-5 w-5 text-primary" />}
        previewClass="h-10 w-10 rounded-lg border border-border bg-white"
      />
      <div className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-xl font-bold flex items-center gap-2">
            <Type className="h-5 w-5 text-primary" /> Site labels
          </h3>
          <button
            onClick={resetLabels}
            className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            <RotateCcw className="h-4 w-4" /> Reset to defaults
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Every visible string on the site lives here. Edits apply instantly across all pages.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                {f.label}
              </span>
              <input
                value={labels[f.key]}
                onChange={(e) => setLabels({ [f.key]: e.target.value })}
                className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
                placeholder={DEFAULT_LABELS[f.key]}
              />
              {f.hint && <span className="text-[10px] text-muted-foreground">{f.hint}</span>}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

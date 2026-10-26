import { useEffect, useMemo, useRef, useState } from "react";
import {
  Megaphone,
  Video as VideoIcon,
  Smartphone,
  Layers,
  Bell,
  Sparkles,
  Save,
  Globe,
  SlidersHorizontal,
  User as UserIcon,
  Image as ImageIcon,
  Rows,
  Film,
  Clock,
} from "lucide-react";
import {
  ADS_EVENT,
  DEFAULT_ADS,
  getAds,
  setAds,
  type AdsState,
  type DeviceTarget,
  type AdPlacementKey,
} from "@/lib/ads-config";

/* ============================================================================
 * Ads & monetisation control panel.
 * Reorganised into a focused sub-tab layout for a cleaner, optimised
 * experience. Banner zones and Native zones are now in dedicated sections,
 * each with their own enable/device controls.
 * ========================================================================== */

type Section =
  | "vast"
  | "banner"
  | "native"
  | "interstitial"
  | "video"
  | "sticky"
  | "push"
  | "popunder"
  | "networks"
  | "intervals"
  | "account";

const SECTIONS: {
  id: Section;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "vast",
    label: "VAST Video",
    icon: <VideoIcon className="h-4 w-4" />,
    desc: "Pre / mid / post-roll",
  },
  {
    id: "banner",
    label: "Banner Zones",
    icon: <ImageIcon className="h-4 w-4" />,
    desc: "Display banners",
  },
  {
    id: "native",
    label: "Native Zones",
    icon: <Rows className="h-4 w-4" />,
    desc: "In-feed native units",
  },
  {
    id: "interstitial",
    label: "Interstitial",
    icon: <Layers className="h-4 w-4" />,
    desc: "Full-page overlays",
  },
  {
    id: "video",
    label: "In-Video & Outstream",
    icon: <Film className="h-4 w-4" />,
    desc: "Slider + outstream",
  },
  {
    id: "sticky",
    label: "Sticky Banner",
    icon: <Smartphone className="h-4 w-4" />,
    desc: "Mobile / desktop dock",
  },
  {
    id: "push",
    label: "Push",
    icon: <Bell className="h-4 w-4" />,
    desc: "Notification ads",
  },
  {
    id: "popunder",
    label: "Popunder",
    icon: <Sparkles className="h-4 w-4" />,
    desc: "Tab-back pops",
  },
  {
    id: "networks",
    label: "Networks & Routing",
    icon: <Globe className="h-4 w-4" />,
    desc: "Mediation rules",
  },
  {
    id: "intervals",
    label: "Feed Intervals",
    icon: <Clock className="h-4 w-4" />,
    desc: "Native injection rate",
  },
  {
    id: "account",
    label: "Account Page",
    icon: <UserIcon className="h-4 w-4" />,
    desc: "Saved videos",
  },
];

function mergeChangedState<T>(current: T, rendered: T, next: T): T {
  if (
    typeof next !== "object" ||
    next === null ||
    Array.isArray(next) ||
    typeof rendered !== "object" ||
    rendered === null ||
    Array.isArray(rendered) ||
    typeof current !== "object" ||
    current === null ||
    Array.isArray(current)
  ) {
    return next !== rendered ? next : current;
  }
  const result = { ...(current as Record<string, unknown>) };
  for (const key of Object.keys(next as Record<string, unknown>)) {
    const renderedValue = (rendered as Record<string, unknown>)[key];
    const nextValue = (next as Record<string, unknown>)[key];
    const currentValue = (current as Record<string, unknown>)[key];
    result[key] = mergeChangedState(currentValue, renderedValue, nextValue);
  }
  return result as T;
}

export function AdsEditor() {
  const [s, setS] = useState<AdsState>(() => getAds());
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [section, setSection] = useState<Section>("vast");
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const stateRef = useRef<AdsState>(s);

  useEffect(() => {
    const sync = () => {
      if (pendingSaves.current === 0) {
        stateRef.current = getAds();
        setS(stateRef.current);
      }
    };
    window.addEventListener(ADS_EVENT, sync);
    return () => window.removeEventListener(ADS_EVENT, sync);
  }, []);

  const commit = (next: AdsState) => {
    const previous = stateRef.current;
    // Controls build a full state object from their render snapshot. Merge only
    // the section changed by this event so rapid toggles cannot overwrite each other.
    const merged = mergeChangedState(previous, s, next);
    stateRef.current = merged;
    setS(merged);
    setSaveError(false);
    pendingSaves.current += 1;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => setAds(stateRef.current))
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      })
      .catch(() => {
        setSaveError(true);
      })
      .finally(() => {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) {
          stateRef.current = getAds();
          setS(stateRef.current);
        }
      });
  };

  const activeMeta = useMemo(
    () => SECTIONS.find((x) => x.id === section)!,
    [section],
  );

  return (
    <div className="space-y-6">
      {/* ----- Header ----- */}
      <header className="rounded-2xl gradient-card p-5 shadow-card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-xl gradient-primary text-primary-foreground inline-flex items-center justify-center shadow-glow">
            <Megaphone className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-xl font-bold leading-tight">
              Ads & monetisation
            </h2>
            <p className="text-xs text-muted-foreground">
              Every change is auto-saved to{" "}
              <code className="text-foreground/80">/api/settings/ads</code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs font-semibold text-primary inline-flex items-center gap-1">
              <Save className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {saveError && (
            <span className="text-xs font-semibold text-destructive">
              Save failed
            </span>
          )}
          <button
            onClick={() => commit(DEFAULT_ADS)}
            className="inline-flex items-center gap-2 rounded-full glass px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
          >
            Reset to defaults
          </button>
        </div>
      </header>

      {/* ----- 2-col layout: sub-nav + content ----- */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
        {/* Sub-nav */}
        <nav className="lg:sticky lg:top-24 self-start space-y-1 rounded-2xl gradient-card p-2 shadow-card">
          {SECTIONS.map((it) => {
            const active = section === it.id;
            return (
              <button
                key={it.id}
                onClick={() => setSection(it.id)}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left transition-all ${
                  active
                    ? "gradient-primary text-primary-foreground shadow-glow font-semibold"
                    : "hover:bg-secondary text-foreground/80"
                }`}
              >
                <span className={`shrink-0 ${active ? "" : "text-primary"}`}>
                  {it.icon}
                </span>
                <span className="flex-1 leading-tight">
                  <span className="block">{it.label}</span>
                  <span
                    className={`block text-[10px] uppercase tracking-wider ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                  >
                    {it.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Section content */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-primary">{activeMeta.icon}</span>
            <span className="uppercase tracking-widest font-semibold">
              {activeMeta.label}
            </span>
            <span className="text-muted-foreground/60">
              — {activeMeta.desc}
            </span>
          </div>

          {section === "vast" && <VastSection s={s} commit={commit} />}
          {section === "banner" && <BannerSection s={s} commit={commit} />}
          {section === "native" && <NativeSection s={s} commit={commit} />}
          {section === "interstitial" && (
            <InterstitialSection s={s} commit={commit} />
          )}
          {section === "video" && <VideoSection s={s} commit={commit} />}
          {section === "sticky" && <StickySection s={s} commit={commit} />}
          {section === "push" && <PushSection s={s} commit={commit} />}
          {section === "popunder" && <PopunderSection s={s} commit={commit} />}
          {section === "networks" && <NetworksSection s={s} commit={commit} />}
          {section === "intervals" && (
            <IntervalsSection s={s} commit={commit} />
          )}
          {section === "account" && <AccountSection s={s} commit={commit} />}
        </div>
      </div>
    </div>
  );
}

/** Boots persisted ad settings on app start (kept for backwards compatibility). */
export function bootAdsConfig() {
  if (typeof window === "undefined") return;
  getAds();
}

/* ============================================================================
 * Sections
 * ========================================================================== */

type P = { s: AdsState; commit: (n: AdsState) => void };

const PLACEMENT_LABELS: Record<AdPlacementKey, string> = {
  homeFeedBanner: "Home feed banner",
  exploreFeedBanner: "Explore feed banner",
  latestFeedBanner: "Latest feed banner",
  trendingFeedBanner: "Trending feed banner",
  searchFeedBanner: "Search feed banner",
  tagsFeedBanner: "Tags feed banner",
  categoryFeedBanner: "Category feed banner",
  relatedFeedBanner: "Related feed banner",
  accountFeedBanner: "Account feed banner",
  watchAbove: "Watch above-player banner",
  watchUnder: "Watch below-player banner",
  watchSidebarBanner: "Watch sidebar banner",
  homeNativeFeed: "Home native feed",
  exploreNative: "Explore native feed",
  latestNative: "Latest native feed",
  trendingNative: "Trending native feed",
  categoryNative: "Category native feed",
  tagsNative: "Tags native feed",
  searchNative: "Search native feed",
  accountNative: "Account native feed",
  watchNativeFeed: "Watch player native",
  watchSidebar: "Watch sidebar native",
  relatedNative: "Related videos native",
  videoSlider: "Video slider",
  watchOutstream: "Legacy watch outstream",
  homeOutstream: "Home feed outstream",
  exploreOutstream: "Explore feed outstream",
  latestOutstream: "Latest feed outstream",
  trendingOutstream: "Trending feed outstream",
  searchOutstream: "Search feed outstream",
  tagsOutstream: "Tags feed outstream",
  categoryOutstream: "Category feed outstream",
  accountOutstream: "Account feed outstream",
  relatedOutstream: "Related feed outstream",
  watchAboveOutstream: "Watch above-player outstream",
  watchBelowOutstream: "Watch below-player outstream",
  watchSidebarOutstream: "Watch sidebar outstream",
  interstitial: "Interstitial",
  sticky: "Sticky banner",
  popunder: "Popunder",
};

const BANNER_PLACEMENTS: AdPlacementKey[] = [
  "homeFeedBanner",
  "exploreFeedBanner",
  "latestFeedBanner",
  "trendingFeedBanner",
  "searchFeedBanner",
  "tagsFeedBanner",
  "categoryFeedBanner",
  "relatedFeedBanner",
  "accountFeedBanner",
  "watchAbove",
  "watchUnder",
  "watchSidebarBanner",
];
const NATIVE_PLACEMENTS: AdPlacementKey[] = [
  "homeNativeFeed",
  "exploreNative",
  "latestNative",
  "trendingNative",
  "categoryNative",
  "tagsNative",
  "searchNative",
  "accountNative",
  "watchNativeFeed",
  "watchSidebar",
  "relatedNative",
];
const OUTSTREAM_PLACEMENTS: AdPlacementKey[] = [
  "homeOutstream",
  "exploreOutstream",
  "latestOutstream",
  "trendingOutstream",
  "searchOutstream",
  "tagsOutstream",
  "categoryOutstream",
  "accountOutstream",
  "relatedOutstream",
  "watchAboveOutstream",
  "watchBelowOutstream",
  "watchSidebarOutstream",
];

function VastSection({ s, commit }: P) {
  const tsTags = s.vast.trafficstarsTags ?? {
    preroll: "",
    midroll: "",
    postroll: "",
  };
  const fp = s.fluidPlayer ?? { enabled: true };
  return (
    <Card
      title="VAST player ads"
      subtitle="Pre-roll, mid-roll and post-roll inside the video player."
    >
      {/* FluidPlayer master toggle */}
      <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">FluidPlayer (VAST wrapper)</p>
            <p className="text-[11px] text-muted-foreground">
              When OFF: the watch page bypasses FluidPlayer and VAST entirely.
              The embed iframe loads directly with autoplay and plays from
              inside the embed — no play overlay, no pre/mid/post-roll ads are
              requested.
            </p>
          </div>
          <Check
            checked={fp.enabled !== false}
            onChange={(v) =>
              commit({ ...s, fluidPlayer: { ...fp, enabled: v } })
            }
            label={fp.enabled !== false ? "Enabled" : "Disabled"}
          />
        </div>
      </div>

      <ToggleHeader
        enabled={s.vast.enabled}
        onToggle={(v) => commit({ ...s, vast: { ...s.vast, enabled: v } })}
        device={s.vast.deviceTarget}
        onDevice={(d) => commit({ ...s, vast: { ...s.vast, deviceTarget: d } })}
        label="VAST enabled"
      />

      <div className="pt-2">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
          ExoClick VAST (Tier-2/3 GEO: Asia, India, LATAM…)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Text
            label="Pre-roll VAST URL"
            value={s.vast.tags.preroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: { ...s.vast, tags: { ...s.vast.tags, preroll: v } },
              })
            }
            placeholder="https://syndication.exoclick.com/splash.php?idzone=…"
          />
          <Text
            label="Mid-roll VAST URL"
            value={s.vast.tags.midroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: { ...s.vast, tags: { ...s.vast.tags, midroll: v } },
              })
            }
            placeholder="https://syndication.exoclick.com/splash.php?idzone=…"
          />
          <Text
            label="Post-roll VAST URL"
            value={s.vast.tags.postroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: { ...s.vast, tags: { ...s.vast.tags, postroll: v } },
              })
            }
            placeholder="https://syndication.exoclick.com/splash.php?idzone=…"
          />
        </div>
      </div>

      <div className="pt-2">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
          TrafficStars VAST (Tier-1 GEO: US, UK, CA, AU, EU)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Text
            label="Pre-roll VAST URL"
            value={tsTags.preroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: {
                  ...s.vast,
                  trafficstarsTags: { ...tsTags, preroll: v },
                },
              })
            }
            placeholder="https://tsyndicate.com/iframes/…/vast.xml"
          />
          <Text
            label="Mid-roll VAST URL"
            value={tsTags.midroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: {
                  ...s.vast,
                  trafficstarsTags: { ...tsTags, midroll: v },
                },
              })
            }
            placeholder="https://tsyndicate.com/iframes/…/vast.xml"
          />
          <Text
            label="Post-roll VAST URL"
            value={tsTags.postroll}
            onChange={(v) =>
              commit({
                ...s,
                vast: {
                  ...s.vast,
                  trafficstarsTags: { ...tsTags, postroll: v },
                },
              })
            }
            placeholder="https://tsyndicate.com/iframes/…/vast.xml"
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          GEO routing rules are shared with banner/native zones (see{" "}
          <b>Networks &amp; Routing</b>): Tier-1 visitors get TrafficStars,
          Tier-2/3 visitors get ExoClick. If only one network is configured,
          that one is used everywhere.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <Check
          checked={s.vast.enablePreroll}
          onChange={(v) =>
            commit({ ...s, vast: { ...s.vast, enablePreroll: v } })
          }
          label="Enable pre-roll"
        />
        <Check
          checked={s.vast.enablePostroll}
          onChange={(v) =>
            commit({ ...s, vast: { ...s.vast, enablePostroll: v } })
          }
          label="Enable post-roll"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Num
          label="Min duration for mid/post-roll (s)"
          value={s.vast.midrollMinDurationSeconds}
          onChange={(v) =>
            commit({ ...s, vast: { ...s.vast, midrollMinDurationSeconds: v } })
          }
        />
        <Num
          label="Mid-roll triggers at (s)"
          value={s.vast.midrollAfterSeconds}
          onChange={(v) =>
            commit({ ...s, vast: { ...s.vast, midrollAfterSeconds: v } })
          }
        />
      </div>
    </Card>
  );
}

function BannerSection({ s, commit }: P) {
  const nb = s.nativeBanner;
  const bannerEnabled = nb.bannerEnabled ?? nb.enabled;
  const bannerDevice = nb.bannerDeviceTarget ?? nb.deviceTarget;

  return (
    <Card
      title="Banner zones"
      subtitle="Display banner ads — top of home, search header, under player."
      accent={<ImageIcon className="h-4 w-4" />}
    >
      <ToggleHeader
        enabled={bannerEnabled}
        onToggle={(v) =>
          commit({ ...s, nativeBanner: { ...nb, bannerEnabled: v } })
        }
        device={bannerDevice}
        onDevice={(d) =>
          commit({ ...s, nativeBanner: { ...nb, bannerDeviceTarget: d } })
        }
        label="Banners enabled"
      />
      <PlacementZoneFields
        placements={BANNER_PLACEMENTS}
        s={s}
        commit={commit}
      />
      <Num
        label="Frequency cap per session (0 = unlimited)"
        value={nb.bannerFrequencyCap ?? nb.frequencyCap ?? 0}
        onChange={(v) =>
          commit({ ...s, nativeBanner: { ...nb, bannerFrequencyCap: v } })
        }
      />

      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2 mt-2">
        <p className="text-sm font-semibold">
          Secondary banner — show inside feeds
        </p>
        <p className="text-[11px] text-muted-foreground">
          Tick a page to inject plain secondary banner ads ALONGSIDE its native
          and outstream ads. All enabled formats share the page's native
          interval and <span className="font-mono">ROTATE</span> — pattern:
          <span className="font-mono">
            {" "}
            video × N → native → video × N → outstream → video × N → banner → …
          </span>
          A disabled format's turns are taken by the enabled ones.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
          {(
            [
              "home",
              "explore",
              "latest",
              "trending",
              "search",
              "tags",
              "category",
              "related",
              "account",
            ] as const
          ).map((p) => (
            <Check
              key={p}
              checked={
                !!(
                  s.nativeBanner.inFeedSecondaryPages &&
                  s.nativeBanner.inFeedSecondaryPages[p]
                )
              }
              onChange={(v) =>
                commit({
                  ...s,
                  nativeBanner: {
                    ...s.nativeBanner,
                    inFeedSecondaryPages: {
                      ...(s.nativeBanner.inFeedSecondaryPages || {}),
                      [p]: v,
                    },
                  },
                })
              }
              label={`Show on ${p[0].toUpperCase() + p.slice(1)} page`}
            />
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2 mt-2">
        <p className="text-sm font-semibold">Sidebar banner display</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Check
            checked={!!nb.sidebarBannerEnabled}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarBannerEnabled: v } })
            }
            label="Sidebar banner enabled"
          />
          <Check
            checked={nb.sidebarBannerDesktop ?? true}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarBannerDesktop: v } })
            }
            label="Show on desktop"
          />
          <Check
            checked={nb.sidebarBannerMobile ?? true}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarBannerMobile: v } })
            }
            label="Show on mobile"
          />
        </div>
      </div>
      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3 mt-2">
        <p className="text-sm font-semibold">Watch page — banner placements</p>
        <div className="space-y-2">
          <Check
            checked={!!nb.watchAboveEnabled}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, watchAboveEnabled: v } })
            }
            label="Show banner ABOVE the video player"
          />
          <div className="grid grid-cols-2 gap-2 pl-4">
            <Check
              checked={nb.watchAboveDesktop ?? true}
              onChange={(v) =>
                commit({ ...s, nativeBanner: { ...nb, watchAboveDesktop: v } })
              }
              label="Show in desktop"
            />
            <Check
              checked={nb.watchAboveMobile ?? true}
              onChange={(v) =>
                commit({ ...s, nativeBanner: { ...nb, watchAboveMobile: v } })
              }
              label="Show in mobile"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Check
            checked={!!nb.watchBelowEnabled}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, watchBelowEnabled: v } })
            }
            label="Show banner BELOW the video player (renders under channel card)"
          />
          <div className="grid grid-cols-2 gap-2 pl-4">
            <Check
              checked={nb.watchBelowDesktop ?? true}
              onChange={(v) =>
                commit({ ...s, nativeBanner: { ...nb, watchBelowDesktop: v } })
              }
              label="Show in desktop"
            />
            <Check
              checked={nb.watchBelowMobile ?? true}
              onChange={(v) =>
                commit({ ...s, nativeBanner: { ...nb, watchBelowMobile: v } })
              }
              label="Show in mobile"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function NativeSection({ s, commit }: P) {
  const nb = s.nativeBanner;
  const nativeEnabled = nb.nativeEnabled ?? nb.enabled;
  const nativeDevice = nb.nativeDeviceTarget ?? nb.deviceTarget;

  return (
    <Card
      title="Native zones"
      subtitle="In-feed native units that blend into video grids and sidebars."
      accent={<Rows className="h-4 w-4" />}
    >
      <ToggleHeader
        enabled={nativeEnabled}
        onToggle={(v) =>
          commit({ ...s, nativeBanner: { ...nb, nativeEnabled: v } })
        }
        device={nativeDevice}
        onDevice={(d) =>
          commit({ ...s, nativeBanner: { ...nb, nativeDeviceTarget: d } })
        }
        label="Native enabled"
      />
      <PlacementZoneFields
        placements={NATIVE_PLACEMENTS}
        s={s}
        commit={commit}
      />
      <Num
        label="Frequency cap per session (0 = unlimited)"
        value={nb.nativeFrequencyCap ?? nb.frequencyCap ?? 0}
        onChange={(v) =>
          commit({ ...s, nativeBanner: { ...nb, nativeFrequencyCap: v } })
        }
      />

      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
        <p className="text-sm font-semibold">Sidebar native display</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Check
            checked={nb.sidebarNativeEnabled !== false}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarNativeEnabled: v } })
            }
            label="Sidebar native enabled"
          />
          <Check
            checked={nb.sidebarNativeDesktop ?? true}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarNativeDesktop: v } })
            }
            label="Show on desktop"
          />
          <Check
            checked={nb.sidebarNativeMobile ?? true}
            onChange={(v) =>
              commit({ ...s, nativeBanner: { ...nb, sidebarNativeMobile: v } })
            }
            label="Show on mobile"
          />
        </div>
      </div>
      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3 mt-2">
        <p className="text-sm font-semibold">Watch page — native placements</p>
        <div className="space-y-2">
          <Check
            checked={!!nb.watchAboveNativeEnabled}
            onChange={(v) =>
              commit({
                ...s,
                nativeBanner: { ...nb, watchAboveNativeEnabled: v },
              })
            }
            label="Show NATIVE ABOVE the video player"
          />
          <div className="grid grid-cols-2 gap-2 pl-4">
            <Check
              checked={nb.watchAboveNativeDesktop ?? true}
              onChange={(v) =>
                commit({
                  ...s,
                  nativeBanner: { ...nb, watchAboveNativeDesktop: v },
                })
              }
              label="Show in desktop"
            />
            <Check
              checked={nb.watchAboveNativeMobile ?? true}
              onChange={(v) =>
                commit({
                  ...s,
                  nativeBanner: { ...nb, watchAboveNativeMobile: v },
                })
              }
              label="Show in mobile"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Check
            checked={!!nb.watchBelowNativeEnabled}
            onChange={(v) =>
              commit({
                ...s,
                nativeBanner: { ...nb, watchBelowNativeEnabled: v },
              })
            }
            label="Show NATIVE BELOW the video player (renders under channel card)"
          />
          <div className="grid grid-cols-2 gap-2 pl-4">
            <Check
              checked={nb.watchBelowNativeDesktop ?? true}
              onChange={(v) =>
                commit({
                  ...s,
                  nativeBanner: { ...nb, watchBelowNativeDesktop: v },
                })
              }
              label="Show in desktop"
            />
            <Check
              checked={nb.watchBelowNativeMobile ?? true}
              onChange={(v) =>
                commit({
                  ...s,
                  nativeBanner: { ...nb, watchBelowNativeMobile: v },
                })
              }
              label="Show in mobile"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Uses the <span className="font-mono">Home — native feed</span> zone
          configured above.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground pt-1">
        Tip: control how often native units appear inside feeds from the{" "}
        <span className="font-semibold text-foreground">Feed Intervals</span>{" "}
        tab.
      </p>
    </Card>
  );
}

function InterstitialSection({ s, commit }: P) {
  const i = s.interstitial;
  return (
    <>
      <Card
        title="Full-page interstitial"
        subtitle="Shown on engagement milestones — never on first load."
      >
        <ToggleHeader
          enabled={i.enabled}
          onToggle={(v) => commit({ ...s, interstitial: { ...i, enabled: v } })}
          device={i.deviceTarget}
          onDevice={(d) =>
            commit({ ...s, interstitial: { ...i, deviceTarget: d } })
          }
          label="Interstitial enabled"
        />
        <PlacementZoneFields
          placements={["interstitial"]}
          s={s}
          commit={commit}
        />

        <Text
          label="Schedule (seconds, comma separated)"
          value={i.schedule.join(", ")}
          onChange={(v) => {
            const parsed = v
              .split(",")
              .map((x) => parseInt(x.trim(), 10))
              .filter((n) => Number.isFinite(n) && n > 0);
            commit({ ...s, interstitial: { ...i, schedule: parsed } });
          }}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Num
            label="Cooldown between shows (s)"
            value={i.cooldown}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, cooldown: v } })
            }
          />
          <Num
            label="Frequency cap per session (0 = unlimited)"
            value={i.frequencyCap}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, frequencyCap: v } })
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Check
            checked={i.showOnOpen}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, showOnOpen: v } })
            }
            label="Show on video open"
          />
          <Check
            checked={i.triggerOnRouteChange}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, triggerOnRouteChange: v } })
            }
            label="Trigger on route changes (never on homepage / first load)"
          />
        </div>
      </Card>

      <Card
        title="Interstitial — advanced cooldowns"
        subtitle="Per-device cooldowns override the global one when non-zero."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Num
            label="Cooldown — desktop (s)"
            value={i.cooldownDesktop}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, cooldownDesktop: v } })
            }
          />
          <Num
            label="Cooldown — mobile (s)"
            value={i.cooldownMobile}
            onChange={(v) =>
              commit({ ...s, interstitial: { ...i, cooldownMobile: v } })
            }
          />
        </div>
      </Card>
    </>
  );
}

function VideoSection({ s, commit }: P) {
  return (
    <>
      <Card
        title="In-video slider"
        subtitle="ExoClick Video IM slider unit shown alongside the player."
      >
        <ZoneUnit
          unit={s.videoSlider}
          onChange={(u) =>
            commit({ ...s, videoSlider: { ...s.videoSlider, ...u } })
          }
        />
        <PlacementZoneFields
          placements={["videoSlider"]}
          s={s}
          commit={commit}
        />
        <Num
          label="Frequency cap per session (0 = unlimited)"
          value={s.videoSlider.frequencyCap ?? 0}
          onChange={(v) =>
            commit({ ...s, videoSlider: { ...s.videoSlider, frequencyCap: v } })
          }
        />
        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-sm font-semibold">Custom dimensions (px)</p>
          <p className="text-[11px] text-muted-foreground">
            Override the slider creative size. Defaults: Desktop 420 × 260,
            Mobile 340 × 220.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <Num
              label="Desktop width (default 420)"
              value={s.videoSlider.widthDesktop ?? 420}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, widthDesktop: v },
                })
              }
            />
            <Num
              label="Desktop height (default 260)"
              value={s.videoSlider.heightDesktop ?? 260}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, heightDesktop: v },
                })
              }
            />
            <Num
              label="Mobile width (default 340)"
              value={s.videoSlider.widthMobile ?? 340}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, widthMobile: v },
                })
              }
            />
            <Num
              label="Mobile height (default 220)"
              value={s.videoSlider.heightMobile ?? 220}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, heightMobile: v },
                })
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-sm font-semibold">Loading gate</p>
          <p className="text-[11px] text-muted-foreground">
            The slider appears once the visitor has scrolled past the threshold
            OR stayed on the page for the delay. After dismissal it re-appears
            once the cooldown elapses.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <Num
              label="Scroll threshold (0..1, default 0.5)"
              value={s.videoSlider.scrollThreshold ?? 0.5}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: {
                    ...s.videoSlider,
                    scrollThreshold: Math.max(0, Math.min(1, v)),
                  },
                })
              }
            />
            <Num
              label="Engagement delay (s, default 12)"
              value={s.videoSlider.engagementDelay ?? 12}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, engagementDelay: v },
                })
              }
            />
            <Num
              label="Cooldown after dismiss (s, default 10)"
              value={s.videoSlider.cooldown ?? 10}
              onChange={(v) =>
                commit({
                  ...s,
                  videoSlider: { ...s.videoSlider, cooldown: Math.max(0, v) },
                })
              }
            />
          </div>
        </div>
      </Card>

      <Card
        title="Outstream video (ExoClick Outstream zone)"
        subtitle="Replaces the legacy under-player banner. Tier-1 → TrafficStars native video, Tier-2/3 → ExoClick outstream."
      >
        <ZoneUnit
          unit={s.outstream}
          onChange={(u) =>
            commit({ ...s, outstream: { ...s.outstream, ...u } })
          }
        />
        <PlacementZoneFields
          placements={OUTSTREAM_PLACEMENTS}
          s={s}
          commit={commit}
        />
        <Num
          label="Frequency cap per session (0 = unlimited)"
          value={s.outstream.frequencyCap ?? 0}
          onChange={(v) =>
            commit({ ...s, outstream: { ...s.outstream, frequencyCap: v } })
          }
        />

        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-sm font-semibold">
            Responsive creative dimensions (px)
          </p>
          <p className="text-[11px] text-muted-foreground">
            Sets the outstream video size on every page. The configured ratio is
            preserved when a column or mobile viewport is narrower.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <Num
              label="Desktop width (default 640)"
              value={s.outstream.widthDesktop ?? 640}
              onChange={(v) =>
                commit({ ...s, outstream: { ...s.outstream, widthDesktop: v } })
              }
            />
            <Num
              label="Desktop height (default 360)"
              value={s.outstream.heightDesktop ?? 360}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, heightDesktop: v },
                })
              }
            />
            <Num
              label="Mobile width (default 340)"
              value={s.outstream.widthMobile ?? 340}
              onChange={(v) =>
                commit({ ...s, outstream: { ...s.outstream, widthMobile: v } })
              }
            />
            <Num
              label="Mobile height (default 191)"
              value={s.outstream.heightMobile ?? 191}
              onChange={(v) =>
                commit({ ...s, outstream: { ...s.outstream, heightMobile: v } })
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-sm font-semibold">Sidebar outstream display</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Check
              checked={s.outstream.sidebarEnabled !== false}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, sidebarEnabled: v },
                })
              }
              label="Sidebar outstream enabled"
            />
            <Check
              checked={s.outstream.sidebarDesktop !== false}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, sidebarDesktop: v },
                })
              }
              label="Show on desktop"
            />
            <Check
              checked={s.outstream.sidebarMobile !== false}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, sidebarMobile: v },
                })
              }
              label="Show on mobile"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <Num
            label="Scroll threshold (0..1)"
            value={s.outstream.scrollThreshold}
            onChange={(v) =>
              commit({
                ...s,
                outstream: {
                  ...s.outstream,
                  scrollThreshold: Math.max(0, Math.min(1, v)),
                },
              })
            }
          />
          <Num
            label="Engagement delay (s)"
            value={s.outstream.engagementDelay}
            onChange={(v) =>
              commit({
                ...s,
                outstream: { ...s.outstream, engagementDelay: v },
              })
            }
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          These settings apply on every page, including the watch page: the ad
          only loads once the visitor has scrolled past the threshold OR stayed
          the delay seconds.
        </p>

        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
          <p className="text-sm font-semibold">
            Secondary outstream — show inside feeds
          </p>
          <p className="text-[11px] text-muted-foreground">
            Tick a page to inject outstream ads ALONGSIDE its native and
            feed-banner ads. All enabled formats share the page's native
            interval and <span className="font-mono">ROTATE</span> — pattern:
            <span className="font-mono">
              {" "}
              video × N → native → video × N → outstream → video × N → banner →
              …
            </span>
            A disabled format's turns are taken by the enabled ones.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
            {(
              [
                "home",
                "explore",
                "latest",
                "trending",
                "search",
                "tags",
                "category",
                "related",
                "account",
              ] as const
            ).map((p) => (
              <Check
                key={p}
                checked={
                  !!(s.outstream.inFeedPages && s.outstream.inFeedPages[p])
                }
                onChange={(v) =>
                  commit({
                    ...s,
                    outstream: {
                      ...s.outstream,
                      inFeedPages: {
                        ...(s.outstream.inFeedPages || {}),
                        [p]: v,
                      },
                    },
                  })
                }
                label={`Show on ${p[0].toUpperCase() + p.slice(1)} page`}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3 mt-2">
          <p className="text-sm font-semibold">
            Watch page — outstream placements
          </p>
          <div className="space-y-2">
            <Check
              checked={!!s.outstream.aboveVideoPlayer}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, aboveVideoPlayer: v },
                })
              }
              label="Show OUTSTREAM ABOVE the video player"
            />
            <div className="grid grid-cols-2 gap-2 pl-4">
              <Check
                checked={s.outstream.aboveDesktop ?? true}
                onChange={(v) =>
                  commit({
                    ...s,
                    outstream: { ...s.outstream, aboveDesktop: v },
                  })
                }
                label="Show in desktop"
              />
              <Check
                checked={s.outstream.aboveMobile ?? true}
                onChange={(v) =>
                  commit({
                    ...s,
                    outstream: { ...s.outstream, aboveMobile: v },
                  })
                }
                label="Show in mobile"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Check
              checked={!!s.outstream.belowVideoPlayer}
              onChange={(v) =>
                commit({
                  ...s,
                  outstream: { ...s.outstream, belowVideoPlayer: v },
                })
              }
              label="Show OUTSTREAM BELOW the video player (renders under channel card)"
            />
            <div className="grid grid-cols-2 gap-2 pl-4">
              <Check
                checked={s.outstream.belowDesktop ?? true}
                onChange={(v) =>
                  commit({
                    ...s,
                    outstream: { ...s.outstream, belowDesktop: v },
                  })
                }
                label="Show in desktop"
              />
              <Check
                checked={s.outstream.belowMobile ?? true}
                onChange={(v) =>
                  commit({
                    ...s,
                    outstream: { ...s.outstream, belowMobile: v },
                  })
                }
                label="Show in mobile"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Note: the watch page sidebar shows outstream on desktop and native
            on mobile automatically.
          </p>
        </div>
      </Card>

      <Card
        title="Video player size"
        subtitle="Override the player width/height in pixels. Leave 0 to use the default responsive 16:9."
      >
        {(() => {
          const p = s.player ?? {
            widthDesktop: 0,
            heightDesktop: 0,
            widthMobile: 0,
            heightMobile: 0,
          };
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <Num
                label={`Desktop width (current: ${p.widthDesktop || "auto"})`}
                value={p.widthDesktop}
                onChange={(v) =>
                  commit({ ...s, player: { ...p, widthDesktop: v } })
                }
              />
              <Num
                label={`Desktop height (current: ${p.heightDesktop || "auto"})`}
                value={p.heightDesktop}
                onChange={(v) =>
                  commit({ ...s, player: { ...p, heightDesktop: v } })
                }
              />
              <Num
                label={`Mobile width (current: ${p.widthMobile || "auto"})`}
                value={p.widthMobile}
                onChange={(v) =>
                  commit({ ...s, player: { ...p, widthMobile: v } })
                }
              />
              <Num
                label={`Mobile height (current: ${p.heightMobile || "auto"})`}
                value={p.heightMobile}
                onChange={(v) =>
                  commit({ ...s, player: { ...p, heightMobile: v } })
                }
              />
            </div>
          );
        })()}
        <p className="text-[11px] text-muted-foreground pt-2">
          Both width AND height must be set for an override to apply (per
          device). Player keeps the ratio you provide and centers within its
          column.
        </p>
      </Card>
    </>
  );
}

function StickySection({ s, commit }: P) {
  return (
    <Card
      title="Sticky banner"
      subtitle="Persistent docked banner — usually mobile-only."
    >
      <ToggleHeader
        enabled={s.sticky.enabled}
        onToggle={(v) => commit({ ...s, sticky: { ...s.sticky, enabled: v } })}
        device={s.sticky.deviceTarget}
        onDevice={(d) =>
          commit({ ...s, sticky: { ...s.sticky, deviceTarget: d } })
        }
        label="Sticky enabled"
      />
      <PlacementZoneFields
        placements={["sticky"]}
        s={s}
        commit={commit}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <Num
          label="Frequency cap per session (0 = unlimited)"
          value={s.sticky.frequencyCap}
          onChange={(v) =>
            commit({ ...s, sticky: { ...s.sticky, frequencyCap: v } })
          }
        />
        <Num
          label="Cooldown after dismiss (s, default 10)"
          value={s.sticky.cooldown ?? 10}
          onChange={(v) =>
            commit({ ...s, sticky: { ...s.sticky, cooldown: Math.max(0, v) } })
          }
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        One universal frequency cap — applies to all devices and both providers
        (ExoClick + TrafficStars). After the visitor closes the bar it
        re-appears once the cooldown elapses.
      </p>
    </Card>
  );
}

function PushSection({ s, commit }: P) {
  const push = s.push;
  return (
    <Card
      title="Push notification ads"
      subtitle="Separate ExoClick and TrafficStars scripts for each device. GEO routing selects the provider."
    >
      <ToggleHeader
        enabled={push.enabled}
        onToggle={(v) => commit({ ...s, push: { ...push, enabled: v } })}
        device={push.deviceTarget}
        onDevice={(d) => commit({ ...s, push: { ...push, deviceTarget: d } })}
        label="Push enabled"
      />
      <Num
        label="Frequency cap per session (0 = unlimited)"
        value={push.frequencyCap ?? 0}
        onChange={(v) => commit({ ...s, push: { ...push, frequencyCap: v } })}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["desktop", "mobile"] as const).map((device) => (
          <div
            key={device}
            className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3"
          >
            <p className="text-sm font-semibold capitalize">{device}</p>
            <Textarea
              label="ExoClick push script"
              value={push.exoclick?.[device] ?? ""}
              onChange={(v) =>
                commit({
                  ...s,
                  push: {
                    ...push,
                    exoclick: { ...push.exoclick, [device]: v },
                  },
                })
              }
            />
            <Textarea
              label="TrafficStars push script"
              value={push.trafficstars?.[device] ?? ""}
              onChange={(v) =>
                commit({
                  ...s,
                  push: {
                    ...push,
                    trafficstars: { ...push.trafficstars, [device]: v },
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The old single Push snippet remains as a fallback for existing
        configurations.
      </p>
    </Card>
  );
}

function PlacementZoneFields({
  placements,
  s,
  commit,
}: P & { placements: AdPlacementKey[] }) {
  const updatePlacement = (
    placement: AdPlacementKey,
    device: "desktop" | "mobile",
    network: "exoclick" | "trafficstars",
    value: string,
  ) => {
    const current = s.placementZones?.[placement] ?? {};
    const deviceConfig = current[device] ?? {};
    commit({
      ...s,
      placementZones: {
        ...s.placementZones,
        [placement]: {
          ...current,
          [device]: { ...deviceConfig, [network]: value },
        },
      },
    });
  };
  const updateFrequency = (
    placement: AdPlacementKey,
    frequencyCap: number,
  ) => {
    const current = s.placementZones?.[placement] ?? {};
    const cap = Math.max(0, frequencyCap);
    commit({
      ...s,
      placementZones: {
        ...s.placementZones,
        [placement]: {
          ...current,
          desktop: { ...(current.desktop ?? {}), frequencyCap: cap },
          mobile: { ...(current.mobile ?? {}), frequencyCap: cap },
        },
      },
    });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-background/30 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold">Placement zones</p>
        <p className="text-[11px] text-muted-foreground">
          Separate network zone IDs for each placement and device. Each
          placement can also override the format-level frequency cap; 0 uses
          the format cap. The cap applies to both desktop and mobile.
        </p>
      </div>
      <div className="space-y-3">
        {placements.map((placement) => {
          const config = s.placementZones?.[placement];
          return (
            <div
              key={placement}
              className="rounded-xl border border-border/60 bg-background/40 p-3"
            >
              <p className="text-sm font-semibold">
                {PLACEMENT_LABELS[placement]}
              </p>
              <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(["desktop", "mobile"] as const).map((device) => (
                  <div
                    key={device}
                    className="rounded-lg border border-border/50 p-3"
                  >
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      {device}
                    </p>
                    <div className="mt-2 space-y-2">
                      <Text
                        label="ExoClick zone ID"
                        value={config?.[device]?.exoclick ?? ""}
                        onChange={(value) =>
                          updatePlacement(placement, device, "exoclick", value)
                        }
                      />
                      <Text
                        label="TrafficStars spot ID"
                        value={config?.[device]?.trafficstars ?? ""}
                        onChange={(value) =>
                          updatePlacement(
                            placement,
                            device,
                            "trafficstars",
                            value,
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <Num
                  label="Frequency cap per session (0 = format cap)"
                  value={
                    config?.desktop?.frequencyCap ||
                    config?.mobile?.frequencyCap ||
                    0
                  }
                  onChange={(value) => updateFrequency(placement, value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NetworksSection({ s, commit }: P) {
  const updateRouter = (patch: Partial<AdsState["router"]>) =>
    commit({
      ...s,
      router: {
        ...s.router,
        emergencyExoOnly: false,
        perPlacement: {
          interstitial: "auto",
          outstream: "auto",
          native: "auto",
          slider: "auto",
        },
        ...patch,
      },
    });
  return (
    <Card
      title="Mediation & routing"
      subtitle="Control network preference and GEO routing."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Check
          checked={s.trafficstars.enabled}
          onChange={(v) =>
            commit({ ...s, trafficstars: { ...s.trafficstars, enabled: v } })
          }
          label="Enable TrafficStars network"
        />
        <Check
          checked={s.router.enabled}
          onChange={(v) => updateRouter({ enabled: v })}
          label="Enable router"
        />
        <Check
          checked={s.router.geoRouting}
          onChange={(v) => updateRouter({ geoRouting: v })}
          label="GEO routing (Tier-1 vs Tier-2/3)"
        />
        <Check
          checked={s.router.enableTier1TS}
          onChange={(v) => updateRouter({ enableTier1TS: v })}
          label="Send Tier-1 traffic to TrafficStars"
        />
        <Check
          checked={!!s.router.forceExoEverywhere}
          onChange={(v) =>
            updateRouter({
              forceExoEverywhere: v,
              forceTSEverywhere: v ? false : s.router.forceTSEverywhere,
            })
          }
          label="FORCE display ExoClick ads in every GEO"
        />
        <Check
          checked={!!s.router.forceTSEverywhere}
          onChange={(v) =>
            updateRouter({
              forceTSEverywhere: v,
              forceExoEverywhere: v ? false : s.router.forceExoEverywhere,
            })
          }
          label="FORCE display TrafficStars ads in every GEO"
        />
        <Select
          label="Default network when router or GEO routing is off"
          value={s.router.defaultNetwork}
          onChange={(v) =>
            updateRouter({ defaultNetwork: v as "exoclick" | "trafficstars" })
          }
          options={[
            { value: "exoclick", label: "ExoClick" },
            { value: "trafficstars", label: "TrafficStars" },
          ]}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Routing logic — Tier-1 GEO (US/UK/CA/AU/DE/NL/EU): TrafficStars primary,
        ExoClick passback. Tier-2/3 GEO: ExoClick primary, TrafficStars
        passback. A slot only passes back when no creative renders within 5
        seconds, or when its provider script is blocked.
      </p>
    </Card>
  );
}

function IntervalsSection({ s, commit }: P) {
  return (
    <Card
      title="Per-page native injection intervals"
      subtitle="How often a native unit appears inside each feed."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Num
          label="Home — every N cards"
          value={s.intervals.homeNativeEvery}
          onChange={(v) =>
            commit({ ...s, intervals: { ...s.intervals, homeNativeEvery: v } })
          }
        />
        <Num
          label="Explore — every N categories"
          value={s.intervals.exploreNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, exploreNativeEvery: v },
            })
          }
        />
        <Num
          label="Latest — every N videos"
          value={s.intervals.latestNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, latestNativeEvery: v },
            })
          }
        />
        <Num
          label="Search — every N results"
          value={s.intervals.searchNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, searchNativeEvery: v },
            })
          }
        />
        <Num
          label="Tags — every N videos"
          value={s.intervals.tagsNativeEvery}
          onChange={(v) =>
            commit({ ...s, intervals: { ...s.intervals, tagsNativeEvery: v } })
          }
        />
        <Num
          label="Category — every N videos"
          value={s.intervals.categoryNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, categoryNativeEvery: v },
            })
          }
        />
        <Num
          label="Trending — every N videos"
          value={s.intervals.trendingNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, trendingNativeEvery: v },
            })
          }
        />
        <Num
          label="Related (watch) — every N cards"
          value={s.intervals.relatedNativeEvery}
          onChange={(v) =>
            commit({
              ...s,
              intervals: { ...s.intervals, relatedNativeEvery: v },
            })
          }
        />
        <Num
          label="Saved (account) — every N videos"
          value={s.intervals.savedNativeEvery}
          onChange={(v) =>
            commit({ ...s, intervals: { ...s.intervals, savedNativeEvery: v } })
          }
        />
      </div>
    </Card>
  );
}

function PopunderSection({ s, commit }: P) {
  const pu = s.popunder;
  return (
    <Card
      title="Popunder ads"
      subtitle="ExoClick + TrafficStars popunder. Tier-1 → TrafficStars, Tier-2/3 → ExoClick (force flags override)."
    >
      <ToggleHeader
        enabled={pu.enabled}
        onToggle={(v) => commit({ ...s, popunder: { ...pu, enabled: v } })}
        device={pu.deviceTarget}
        onDevice={(d) => commit({ ...s, popunder: { ...pu, deviceTarget: d } })}
        label="Popunder enabled"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["desktop", "mobile"] as const).map((device) => (
          <div
            key={device}
            className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-3"
          >
            <p className="text-sm font-semibold capitalize">{device}</p>
            <Textarea
              label="ExoClick popunder script"
              value={pu.exoclick?.[device] ?? ""}
              onChange={(v) =>
                commit({
                  ...s,
                  popunder: {
                    ...pu,
                    exoclick: { ...pu.exoclick, [device]: v },
                  },
                })
              }
            />
            <Textarea
              label="TrafficStars popunder script"
              value={pu.trafficstars?.[device] ?? ""}
              onChange={(v) =>
                commit({
                  ...s,
                  popunder: {
                    ...pu,
                    trafficstars: { ...pu.trafficstars, [device]: v },
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Num
          label="Frequency cap per session (0 = unlimited)"
          value={pu.frequencyCap}
          onChange={(v) =>
            commit({ ...s, popunder: { ...pu, frequencyCap: v } })
          }
        />
        <Num
          label="Cooldown between pops (s)"
          value={pu.cooldown}
          onChange={(v) => commit({ ...s, popunder: { ...pu, cooldown: v } })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Existing generic popunder snippets remain as migration fallbacks.
      </p>
      <div className="rounded-xl border border-border/60 bg-background/40 p-3 space-y-2">
        <p className="text-sm font-semibold">Show on pages</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-1">
          {(
            [
              ["home", "Home"],
              ["explore", "Explore"],
              ["latest", "Latest"],
              ["trending", "Trending"],
              ["search", "Search"],
              ["tags", "Tags"],
              ["category", "Category"],
              ["watch", "Watch"],
              ["account", "Account"],
            ] as const
          ).map(([p, label]) => (
            <Check
              key={p}
              checked={!!pu.pages[p]}
              onChange={(v) =>
                commit({
                  ...s,
                  popunder: { ...pu, pages: { ...pu.pages, [p]: v } },
                })
              }
              label={`Show on ${label} page`}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function AccountSection({ s, commit }: P) {
  return (
    <Card
      title="Account / Saved page"
      subtitle="Lightweight monetisation for the saved videos page."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Check
          checked={s.account.bannerEnabled}
          onChange={(v) =>
            commit({ ...s, account: { ...s.account, bannerEnabled: v } })
          }
          label="Enable banner above saved videos grid"
        />
        <Check
          checked={s.account.nativeEnabled}
          onChange={(v) =>
            commit({ ...s, account: { ...s.account, nativeEnabled: v } })
          }
          label="Enable native ads inside saved videos grid"
        />
        <Check
          checked={s.account.outstreamEnabled ?? false}
          onChange={(v) =>
            commit({ ...s, account: { ...s.account, outstreamEnabled: v } })
          }
          label="Enable outstream ads inside saved videos grid"
        />
      </div>
    </Card>
  );
}

/* ============================================================================
 * Reusable UI atoms
 * ========================================================================== */

function Card({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle?: string;
  accent?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl gradient-card p-5 md:p-6 shadow-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base md:text-lg font-bold flex items-center gap-2">
            {accent && <span className="text-primary">{accent}</span>}
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleHeader({
  label,
  enabled,
  onToggle,
  device,
  onDevice,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  device: DeviceTarget;
  onDevice: (d: DeviceTarget) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/40 border border-border/60 p-3">
      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="sr-only peer"
        />
        <span className="h-5 w-9 rounded-full bg-secondary relative peer-checked:gradient-primary transition-all after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-foreground after:transition-all peer-checked:after:translate-x-4" />
        <span className="text-sm font-semibold">{label}</span>
      </label>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Device
        </span>
        <select
          value={device}
          onChange={(e) => onDevice(e.target.value as DeviceTarget)}
          className="rounded-lg bg-background border border-border px-3 py-1.5 text-xs outline-none focus:border-primary/60"
        >
          <option value="all">All</option>
          <option value="desktop">Desktop only</option>
          <option value="mobile">Mobile only</option>
        </select>
      </div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow font-mono"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-xs font-mono outline-none focus:shadow-glow"
      />
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2 text-sm outline-none focus:shadow-glow"
      />
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm rounded-lg bg-background/40 border border-border/60 px-3 py-2 cursor-pointer hover:bg-background/70 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      {label}
    </label>
  );
}

function Select({
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
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
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

function ZoneUnit({
  unit,
  onChange,
}: {
  unit: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    frequencyCap: number;
    zoneId: string;
  };
  onChange: (u: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    frequencyCap: number;
    zoneId: string;
  }) => void;
}) {
  return (
    <>
      <ToggleHeader
        label="Enabled"
        enabled={unit.enabled}
        onToggle={(v) => onChange({ ...unit, enabled: v })}
        device={unit.deviceTarget}
        onDevice={(d) => onChange({ ...unit, deviceTarget: d })}
      />
    </>
  );
}

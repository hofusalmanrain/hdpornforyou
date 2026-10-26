import { Link, useLocation, useNavigate } from "react-router";
import { Search, Flame, Compass, Home, Menu, User, Sun, Moon, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLabels } from "@/hooks/use-labels";
import { useAuth } from "@/hooks/use-auth";
import { useVideos } from "@/hooks/use-videos";
import { useBrandLogo } from "@/hooks/use-brand-logo";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { formatViews, watchPathFor } from "@/data/videos";
import { saveScrollPosition } from "@/lib/scroll-memory";
import { getThemeMode, setThemeMode, THEME_MODE_EVENT, type ThemeMode } from "@/lib/theme-mode";

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const labels = useLabels();
  const { user } = useAuth();
  const all = useVideos();
  const brandLogoUrl = useBrandLogo();
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return all
      .filter(
        (v) =>
          v.title.toLowerCase().includes(term) ||
          v.channel.toLowerCase().includes(term) ||
          v.tags.some((t) => t.toLowerCase().includes(term)),
      )
      .slice(0, 8);
  }, [all, q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setFocused(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setOpen(false);
    setFocused(false);
  }, [location.pathname, location.search]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      saveScrollPosition();
      navigate(`/search?q=${encodeURIComponent(q.trim()).replace(/%20/g, "+")}`);
      // Clear the field on submit: cross-page searches remount the Navbar
      // (fresh empty state), so clear here too for identical behavior when
      // searching from the search page itself.
      setQ("");
      // Drop focus so the user isn't left sitting in the topbar field.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  };

  const instantMouseNav = (e: React.PointerEvent, to: string) => {
    if (
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const current = location.pathname + location.search + location.hash;
    if (to === current) return;
    e.preventDefault();
    saveScrollPosition();
    navigate(to);
  };

  const showPopover = focused && q.trim().length > 0;
  const visible = useHideOnScroll({ hideAfter: 72, threshold: 8, disabled: open || focused });

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-[110] px-4 pt-6 md:pt-7 will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${visible ? "translate-y-0" : "-translate-y-[calc(100%+24px)]"}`}
    >
      <nav className="glass-strong relative overflow-visible mx-auto flex max-w-7xl items-center gap-3 rounded-2xl pl-16 md:pl-20 pr-4 py-2.5 md:gap-6 md:px-6 md:pl-20 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150 supports-[backdrop-filter]:bg-card/50">
        <Link
          to="/"
          onPointerDown={(e) => instantMouseNav(e, "/")}
          className="flex items-center gap-2 shrink-0"
        >
          <div className="absolute left-4 top-0 z-20" style={{ transform: "translateY(-20%)" }}>
            {brandLogoUrl ? (
              <img
                src={brandLogoUrl}
                alt={labels.brandName}
                width={56}
                height={56}
                className="h-14 w-14 md:h-16 md:w-16 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="h-14 w-14 md:h-16 md:w-16 flex items-center justify-center">
                <span className="font-display text-xl md:text-2xl font-bold text-primary-foreground drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]">
                  {labels.brandName.charAt(0)}
                </span>
              </div>
            )}
          </div>
          <span className="hidden sm:block font-display text-xl font-bold tracking-tight">
            {labels.brandName.slice(0, Math.ceil(labels.brandName.length / 2))}
            <span className="text-gradient">
              {labels.brandName.slice(Math.ceil(labels.brandName.length / 2))}
            </span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-1 ml-2">
          <NavLink to="/" icon={<Home className="h-4 w-4" />} label="Home" />
          <NavLink to="/trending" icon={<Flame className="h-4 w-4" />} label="Trending" />
          <NavLink to="/explore" icon={<Compass className="h-4 w-4" />} label="Explore" />
        </div>

        <div ref={wrapRef} className="relative flex-1 max-w-xl mx-auto">
          <form onSubmit={onSubmit}>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => {
                  setFocused(true);
                  setOpen(false);
                }}
                placeholder="Search 18+ videos, categories, tags…"
                className="w-full bg-secondary/60 hover:bg-secondary focus:bg-secondary border border-border focus:border-primary/60 rounded-full pl-10 pr-4 py-2 text-sm outline-none transition-all focus:shadow-glow"
              />
            </div>
          </form>

          {showPopover && (
            <div className="hidden md:block absolute left-0 right-0 top-full mt-[19px] glass-strong rounded-2xl overflow-hidden z-50 animate-fade-up supports-[backdrop-filter]:backdrop-blur-xl">
              {results.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No videos match “{q}”.
                </p>
              ) : (
                <ul className="max-h-96 overflow-y-auto divide-y divide-border">
                  {results.map((v) => (
                    <li key={v.id}>
                      <Link
                        to={watchPathFor(v)}
                        onClick={() => {
                          setFocused(false);
                          setQ("");
                        }}
                        className="flex items-center gap-3 p-2.5 hover:bg-secondary/60 transition-colors"
                      >
                        <img
                          src={v.thumbnail}
                          alt={v.title}
                          width={80}
                          height={48}
                          loading="lazy"
                          className="h-12 w-20 object-cover rounded-md shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{v.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {v.channel} · {formatViews(v.views)} views
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => {
                  saveScrollPosition();
                  navigate(`/search?q=${encodeURIComponent(q.trim()).replace(/%20/g, "+")}`);
                  setFocused(false);
                  setQ("");
                  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                }}
                className="w-full px-4 py-2.5 text-xs font-semibold text-primary hover:bg-secondary/60 border-t border-border text-left"
              >
                See all results for “{q}” →
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="md:hidden p-2 rounded-lg hover:bg-secondary"
          aria-label="Toggle navigation menu"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>

        <ThemeToggle />

        <Link
          to="/account"
          className="hidden md:inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform"
        >
          <User className="h-4 w-4" /> {user ? user.fullName || user.username : "Sign in"}
        </Link>
      </nav>

      {showPopover && (
        <div
          ref={popupRef}
          className="md:hidden mt-2 glass-strong mx-auto max-w-7xl rounded-2xl overflow-hidden z-50 animate-fade-up supports-[backdrop-filter]:backdrop-blur-xl"
        >
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No videos match “{q}”.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-border">
              {results.map((v) => (
                <li key={v.id}>
                  <Link
                    to={watchPathFor(v)}
                    onClick={() => {
                      setFocused(false);
                      setQ("");
                    }}
                    className="flex items-center gap-3 p-2.5 hover:bg-secondary/60 transition-colors"
                  >
                    <img
                      src={v.thumbnail}
                      alt={v.title}
                      width={80}
                      height={48}
                      loading="lazy"
                      className="h-12 w-20 object-cover rounded-md shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{v.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {v.channel} · {formatViews(v.views)} views
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => {
              saveScrollPosition();
              navigate(`/search?q=${encodeURIComponent(q.trim()).replace(/%20/g, "+")}`);
              setFocused(false);
            }}
            className="w-full px-4 py-2.5 text-xs font-semibold text-primary hover:bg-secondary/60 border-t border-border text-left"
          >
            See all results for “{q}” →
          </button>
        </div>
      )}

      {open && (
        <div className="md:hidden mt-2 glass-strong mx-auto max-w-7xl rounded-2xl p-3 space-y-1 animate-fade-up supports-[backdrop-filter]:backdrop-blur-xl">
          <MobileLink to="/" label="Home" />
          <MobileLink to="/trending" label="Trending" />
          <MobileLink to="/explore" label="Explore" />
          <MobileLink to="/search" label="Search" />
          <MobileLink to="/account" label="Account" />
          <MobileThemeToggle />
        </div>
      )}
    </header>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive =
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  const instantMouseNav = (e: React.PointerEvent) => {
    if (
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const current = location.pathname + location.search + location.hash;
    if (to === current) return;
    e.preventDefault();
    saveScrollPosition();
    navigate(to);
  };

  return (
    <Link
      to={to}
      onPointerDown={instantMouseNav}
      aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
        isActive
          ? "text-primary bg-primary/10 font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function MobileLink({ to, label }: { to: string; label: string }) {
  const location = useLocation();
  const isActive =
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      onClick={() => saveScrollPosition()}
      aria-current={isActive ? "page" : undefined}
      className={`block touch-manipulation px-4 py-2.5 rounded-xl font-medium transition-colors ${
        isActive ? "text-primary bg-primary/10" : "hover:bg-secondary"
      }`}
    >
      {label}
    </Link>
  );
}

const MODE_ICON: Record<ThemeMode, React.ReactNode> = {
  system: <Monitor className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  dark: <Moon className="h-4 w-4" />,
};

const MODE_LABEL: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const MODE_NEXT: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
};

function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode());
  useEffect(() => {
    const on = () => setMode(getThemeMode());
    window.addEventListener(THEME_MODE_EVENT, on);
    return () => window.removeEventListener(THEME_MODE_EVENT, on);
  }, []);
  return mode;
}

function ThemeToggle() {
  const mode = useThemeMode();
  return (
    <button
      type="button"
      onClick={() => setThemeMode(MODE_NEXT[mode])}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch.`}
      title={`Theme: ${MODE_LABEL[mode]}`}
      className="hidden md:inline-flex items-center justify-center rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      {MODE_ICON[mode]}
    </button>
  );
}

function MobileThemeToggle() {
  const mode = useThemeMode();
  return (
    <button
      type="button"
      onClick={() => setThemeMode(MODE_NEXT[mode])}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Click to switch.`}
      className="w-full touch-manipulation flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium hover:bg-secondary transition-colors"
    >
      <span className="text-muted-foreground">{MODE_ICON[mode]}</span>
      Theme: {MODE_LABEL[mode]}
    </button>
  );
}

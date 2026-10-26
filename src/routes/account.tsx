import { Link } from "react-router";
import {
  LogOut,
  Mail,
  User as UserIcon,
  ShieldCheck,
  Calendar,
  Bookmark,
  Search as SearchIcon,
  Save,
  Pencil,
  Eye,
  EyeOff,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { VideoCard } from "@/components/site/VideoCard";
import { AdSlot } from "@/components/site/AdSlot";
import { OutstreamAd } from "@/components/site/OutstreamAd";
import { useAuth } from "@/hooks/use-auth";
import { useLabels } from "@/hooks/use-labels";
import { getSeo } from "@/lib/seo-store";
import { login, logout, signup, updateFullName, checkEmailExists } from "@/lib/auth-store";
import {
  fetchSavedVideos,
  getCachedSavedVideos,
  savedVideosReady,
  SAVED_EVENT,
} from "@/lib/saved-store";
import { getAds, pickFeedSlot } from "@/lib/ads-config";
import { planFeedAdSlots } from "@/lib/feed-layout";
import type { Video } from "@/data/videos";

export default function AccountPage() {
  const { user } = useAuth();
  const labels = useLabels();

  useEffect(() => {
    const seo = getSeo();
    const brand = seo.og.siteName || labels.brandName || "HDPORNFORYOU";
    const title = `Your account | ${brand}`;
    const prevTitle = document.title;
    document.title = title;
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    const prevRobots = robots.content;
    robots.content = "noindex, nofollow";
    const base = (seo.canonicalBase?.trim().replace(/\/$/, "") || window.location.origin);
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    const prevHref = link.href;
    link.href = `${base}/account`;
    return () => {
      document.title = prevTitle;
      const cur = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (cur) cur.content = prevRobots || "index,follow";
      if (prevHref) {
        // let next route recreate canonical
      }
    };
  }, [labels.brandName]);

  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-3xl mx-auto px-4 md:px-8">
        <header className="mb-8">
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            <span className="text-gradient">{labels.accountTitle}</span>
          </h1>
          <p className="text-muted-foreground mt-1">{labels.accountSubtitle}</p>
        </header>

        {user ? (
          <>
            <Profile />
            <SavedVideos />
          </>
        ) : (
          <AuthTabs />
        )}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

function SavedVideos() {
  const [videos, setVideos] = useState<Video[]>(() => getCachedSavedVideos());
  const [loading, setLoading] = useState(() => !savedVideosReady());
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!savedVideosReady()) setLoading(true);
      fetchSavedVideos()
        .then((vs) => {
          if (alive) setVideos(vs);
        })
        .catch(() => {
          if (alive) setVideos([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load();
    window.addEventListener(SAVED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(SAVED_EVENT, load);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return videos;
    return videos.filter(
      (v) =>
        v.title.toLowerCase().includes(needle) ||
        v.channel.toLowerCase().includes(needle) ||
        v.category.toLowerCase().includes(needle) ||
        (v.slug ?? "").toLowerCase().includes(needle) ||
        v.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [videos, q]);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="font-display text-2xl font-bold flex items-center gap-2">
          <Bookmark className="h-5 w-5 text-primary" /> Saved videos
          <span className="text-sm font-normal text-muted-foreground">({videos.length})</span>
        </h2>
        {videos.length > 0 && (
          <div className="relative ml-auto flex-1 min-w-[200px] max-w-sm">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your saved videos…"
              className="w-full rounded-full bg-background border border-border focus:border-primary/60 pl-10 pr-4 py-2 text-sm outline-none focus:shadow-glow"
            />
          </div>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your saved library…</p>
      ) : videos.length === 0 ? (
        <div className="rounded-2xl gradient-card p-6 shadow-card text-sm text-muted-foreground">
          You haven't saved any videos yet. Tap the Save button on any video to add it here.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl gradient-card p-6 shadow-card text-sm text-muted-foreground">
          No saved videos match "{q}".
        </div>
      ) : (
        <>
          {getAds().account.bannerEnabled && (
            <div className="mb-4 empty:hidden">
              <AdSlot placement="accountFeedBanner" format="banner" label="Sponsored" />
            </div>
          )}
          <div className="grid grid-flow-row-dense grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(() => {
              const feedEvery = Math.max(2, getAds().intervals.savedNativeEvery || 10);
              const adPlan = planFeedAdSlots(filtered.length, (idx) => {
                const s = pickFeedSlot(idx, feedEvery, "account");
                return s === "none" ? null : s;
              }, feedEvery);
              return filtered.map((v, i) => {
              const adsHere = adPlan.get(i) ?? [];
              const showNative = adsHere.includes("native");
              const showOutstream = adsHere.includes("outstream");
              const showBanner = adsHere.includes("banner");
              return (
                <Fragment key={v.id}>
                  <VideoCard video={v} size="compact" />
                  {showNative && (
                      <AdSlot placement="accountNative" format="native" label="Sponsored" className="col-span-full" />
                  )}
                  {showOutstream && (
                    <OutstreamAd
                      placement="accountOutstream"
                      feed
                      className="col-span-full lg:col-span-2"
                    />
                  )}
                  {showBanner && (
                      <AdSlot placement="accountFeedBanner" format="banner" label="Sponsored" className="col-span-full" />
                  )}
                </Fragment>
              );
              });
            })()}
          </div>
        </>
      )}
    </section>
  );
}

function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.fullName || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the local edit field in sync if the user object changes elsewhere.
  useEffect(() => {
    setName(user?.fullName || "");
  }, [user?.fullName]);

  if (!user) return null;
  const displayName = user.fullName || user.username;

  const submitName = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Name can't be empty.");
      return;
    }
    setSaving(true);
    const res = await updateFullName(name.trim());
    setSaving(false);
    if (!res.ok) setErr(res.error);
    else setEditing(false);
  };

  return (
    <div className="rounded-2xl gradient-card p-6 shadow-card animate-fade-up">
      <div className="flex items-center gap-4">
        <div
          className="h-16 w-16 rounded-full flex items-center justify-center font-display text-2xl font-bold text-white shadow-glow"
          style={{ background: user.avatarColor }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold truncate">{displayName}</h2>
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
          >
            <Pencil className="h-3 w-3" /> Edit name
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={submitName} className="mt-5 rounded-xl bg-secondary/40 p-4 space-y-3">
          <Field label="Full name" value={name} onChange={setName} placeholder="Your full name" />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(user.fullName || "");
                setErr(null);
              }}
              className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InfoRow icon={<UserIcon className="h-4 w-4" />} label="Full name" value={displayName} />
        <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={user.email} />
        <InfoRow
          icon={<Calendar className="h-4 w-4" />}
          label="Member since"
          value={new Date(user.createdAt).toLocaleDateString()}
        />
        <InfoRow icon={<ShieldCheck className="h-4 w-4" />} label="Plan" value="Free" />
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-full bg-destructive/20 text-destructive px-5 py-2.5 text-sm font-semibold hover:bg-destructive/30"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full glass px-5 py-2.5 text-sm font-semibold hover:bg-secondary"
        >
          Continue browsing
        </Link>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/40 p-4">
      <dt className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function AuthTabs() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  return (
    <div className="rounded-2xl gradient-card p-6 shadow-card animate-fade-up">
      <div className="grid grid-cols-2 rounded-full bg-secondary/60 p-1 mb-6">
        <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>
          Create account
        </TabBtn>
        <TabBtn active={mode === "signin"} onClick={() => setMode("signin")}>
          Sign in
        </TabBtn>
      </div>
      {mode === "signup" ? (
        <SignupForm onSwitchToSignin={() => setMode("signin")} />
      ) : (
        <SigninForm onSwitchToSignup={() => setMode("signup")} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${active ? "gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Signup form. Gmail-style flow:
 *  - When the email field loses focus, we ping /api/account/check-email to
 *    see if the address already has an account. If so, we tell the user to
 *    sign in instead (and offer a one-click switch to the sign-in tab).
 */
function SignupForm({ onSwitchToSignin }: { onSwitchToSignin: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [p, setP] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkEmail = async () => {
    const e = email.trim().toLowerCase();
    setEmailTaken(false);
    if (!EMAIL_RX.test(e)) return;
    setChecking(true);
    try {
      const exists = await checkEmailExists(e);
      setEmailTaken(exists);
    } finally {
      setChecking(false);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Please enter your full name.");
      return;
    }
    if (!EMAIL_RX.test(email.trim())) {
      setErr("Enter a valid email address.");
      return;
    }
    if (emailTaken) {
      setErr("An account with this email already exists. Please sign in instead.");
      return;
    }
    if (p.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (confirm !== p) {
      setErr("Passwords do not match.");
      return;
    }
    const res = await signup(name.trim(), email.trim(), p);
    if (!res.ok) {
      setErr(res.error);
      if (/already exists|in use/i.test(res.error)) setEmailTaken(true);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
      <div>
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            setEmailTaken(false);
          }}
          onBlur={checkEmail}
          placeholder="you@gmail.com"
        />
        {checking && <p className="text-xs text-muted-foreground mt-1">Checking…</p>}
        {emailTaken && (
          <p className="text-xs text-destructive mt-1">
            An account with this email already exists.{" "}
            <button type="button" onClick={onSwitchToSignin} className="underline font-semibold">
              Sign in instead
            </button>
            .
          </p>
        )}
      </div>
      <Field
        label="Password"
        type="password"
        value={p}
        onChange={setP}
        placeholder="Minimum 6 characters"
      />
      <Field
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        placeholder="Re-enter your password"
      />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <button className="w-full rounded-full gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-[1.01] transition-transform">
        Create account
      </button>
      <p className="text-xs text-muted-foreground text-center">
        By signing up you confirm you are 18+ and agree to our{" "}
        <a href="/terms" className="underline">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}

/**
 * Sign-in form. Gmail-style flow:
 *  - When the user enters an email that doesn't exist, we show a friendly
 *    "no account found — create one" link instead of a generic error.
 */
function SigninForm({ onSwitchToSignup }: { onSwitchToSignup: () => void }) {
  const [email, setEmail] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [emailMissing, setEmailMissing] = useState(false);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    setEmailMissing(false);
    if (!EMAIL_RX.test(email.trim())) {
      setErr("Enter a valid email address.");
      return;
    }
    // Pre-flight Gmail-style existence check so the error is specific.
    const exists = await checkEmailExists(email.trim());
    if (!exists) {
      setEmailMissing(true);
      setErr("No account found for this email.");
      return;
    }
    const res = await login(email.trim(), p);
    if (!res.ok) setErr(res.error);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          setEmailMissing(false);
        }}
        placeholder="you@gmail.com"
      />
      <Field label="Password" type="password" value={p} onChange={setP} />
      {err && (
        <p className="text-sm text-destructive">
          {err}
          {emailMissing && (
            <>
              {" "}
              <button type="button" onClick={onSwitchToSignup} className="underline font-semibold">
                Create one now
              </button>
              .
            </>
          )}
        </p>
      )}
      <button className="w-full rounded-full gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-[1.01] transition-transform">
        Sign in
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="relative mt-1 block">
        <input
          type={isPw && showPw ? "text" : type}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`w-full rounded-lg bg-background border border-border focus:border-primary/60 px-3 py-2.5 text-sm outline-none focus:shadow-glow ${isPw ? "pr-10" : ""}`}
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

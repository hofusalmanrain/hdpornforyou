/**
 * First-run setup wizard.
 *
 * Detects an empty admin table via /api/setup/status and creates the
 * first admin. Once one admin exists, this page redirects to /admin.
 * The state is server-side, so every browser sees the same result.
 */
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getSetupStatus, initializeSetup } from "@/lib/auth-store";
import { getSeo } from "@/lib/seo-store";

function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={6}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          const input = e.currentTarget.parentElement?.querySelector("input");
          const start = input?.selectionStart ?? null;
          const end = input?.selectionEnd ?? null;
          setShow((v) => !v);
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
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}
import { useLabels } from "@/hooks/use-labels";

export default function SetupPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const seo = getSeo();
    const brand = seo.og.siteName || labels.brandName || "HDPORNFORYOU";
    const title = `Setup | ${brand}`;
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
    link.href = `${base}/setup`;
    return () => {
      document.title = prevTitle;
      const cur = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
      if (cur) cur.content = prevRobots || "index,follow";
      if (prevHref) {
        // let next route recreate canonical
      }
    };
  }, [labels.brandName]);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then(async (r) => {
        setNeedsSetup(r.needsSetup);
        if (!r.needsSetup) {
          // Setup already done — admin prefix is private; send users home.
          navigate("/");
        }
      })
      .catch(() => setError("Could not reach the server."))
      .finally(() => setChecking(false));
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const r = await initializeSetup(username, password);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // Fresh install — default admin prefix is "admin".
    navigate("/admin");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Checking setup status…</p>
      </div>
    );
  }

  if (!needsSetup) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg space-y-5"
      >
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Welcome — set up your admin</h1>
          <p className="text-sm text-muted-foreground">
            This runs once. Create the admin account that controls every browser.
          </p>
        </header>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Admin username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            autoComplete="username"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Password</span>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Confirm password</span>
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </label>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create admin & continue"}
        </button>
      </form>
    </div>
  );
}

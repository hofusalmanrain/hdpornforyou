import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

const AGE_KEY = "hdpornforyou:age-verified";

export function AgeVerification() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const verified = localStorage.getItem(AGE_KEY);
    if (verified !== "yes") setShow(true);
  }, []);

  const handleYes = () => {
    localStorage.setItem(AGE_KEY, "yes");
    setShow(false);
  };

  const handleNo = () => {
    localStorage.setItem(AGE_KEY, "no");
    window.location.href = "https://www.google.com";
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[24px] glass-card p-8 text-center space-y-6 animate-fade-up relative overflow-hidden">
        {/* glass highlight — top edge reflection */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
        {/* soft glow behind icon */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 h-32 w-48 rounded-full bg-primary/20 blur-3xl opacity-60"
        />
        <div className="relative h-16 w-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto shadow-glow">
          <ShieldAlert className="h-8 w-8 text-primary-foreground" />
        </div>
        <div className="relative">
          <h2 className="font-display text-2xl font-bold">Adults Only — 18+</h2>
          <p className="text-sm text-muted-foreground mt-2">
            This website contains explicit adult content and is intended solely for persons who are
            at least 18 years of age (or the age of majority in your jurisdiction, whichever is
            greater). By clicking &quot;I am 18 or older&quot; you confirm that explicit sexual
            material is legal in your location and that you voluntarily wish to view it. All models
            are 18+.
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            This site is labeled with the RTA (Restricted To Adults) label. Parents, you can easily
            block access to this site with parental-control tools. Learn more at{" "}
            <a
              href="https://www.rtalabel.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              rtalabel.org
            </a>{" "}
            ·{" "}
            <a
              href="/2257"
              className="text-primary underline"
              onClick={(e) => {
                e.preventDefault();
                window.open("/2257", "_blank");
              }}
            >
              2257 Statement
            </a>{" "}
            ·{" "}
            <a href="/privacy" className="text-primary underline">
              Privacy
            </a>
          </p>
        </div>
        <div className="relative flex gap-3 justify-center">
          <button
            onClick={handleNo}
            className="rounded-full glass px-6 py-3 text-sm font-semibold hover:bg-white/10 backdrop-blur-md border-white/15 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          >
            I Am Under 18 — Exit
          </button>
          <button
            onClick={handleYes}
            className="rounded-full gradient-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 active:scale-95 transition-transform cursor-pointer"
          >
            I Am 18 or Older — Enter
          </button>
        </div>
      </div>
    </div>
  );
}

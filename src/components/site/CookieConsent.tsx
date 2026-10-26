import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_KEY } from "@/lib/ads-config";

type CookieChoice = "accepted" | "declined" | null;

function getStoredChoice(): CookieChoice {
  try {
    const v = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (v === "accepted" || v === "declined") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function setStoredChoice(choice: "accepted" | "declined") {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, choice);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
}

export function CookieConsent() {
  const [choice, setChoice] = useState<CookieChoice>(null);

  useEffect(() => {
    setChoice(getStoredChoice());
  }, []);

  if (choice) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[120] p-3 animate-fade-up md:bottom-0 md:p-4">
      <div className="mx-auto max-h-[calc(100dvh-6rem)] max-w-2xl overflow-y-auto rounded-2xl gradient-card p-4 shadow-card border border-border/50 backdrop-blur-xl sm:p-5 md:max-h-[calc(100dvh-2rem)]">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-glow">
            <Cookie className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-display text-base font-bold">Cookies — 18+ Site</h4>
            <p className="text-sm text-muted-foreground mt-1">
              We use essential cookies (age gate, sign-in) and ad/analytics cookies (Eporner embeds,
              ExoClick / TrafficStars) for 18+ embedded videos and ad frequency. Accept to consent.{" "}
              <a href="/privacy" className="text-primary underline">
                Privacy Policy
              </a>
              . Declining may break embeds.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button
            onClick={() => {
              setStoredChoice("declined");
              setChoice("declined");
            }}
            className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
          >
            Decline
          </button>
          <button
            onClick={() => {
              setStoredChoice("accepted");
              setChoice("accepted");
            }}
            className="rounded-full gradient-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform"
          >
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}

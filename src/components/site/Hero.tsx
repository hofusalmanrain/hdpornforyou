import { Link } from "react-router";
import { Play, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { formatViews, watchPathFor, type Video } from "@/data/videos";
import { useLabels } from "@/hooks/use-labels";

export function Hero({ slides }: { slides: Video[] }) {
  const labels = useLabels();
  const [idx, setIdx] = useState(0);
  const safeIdx = slides.length ? Math.min(idx, slides.length - 1) : 0;

  // Auto-scroll every 5s — timer resets after manual navigation so badge/text
  // never appears to "disappear" due to a race between click and interval.
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = window.setTimeout(() => setIdx((i) => (i + 1) % slides.length), 5000);
    return () => window.clearTimeout(t);
  }, [slides.length, idx]);

  useEffect(() => {
    if (idx >= slides.length) setIdx(0);
  }, [idx, slides.length]);

  if (!slides.length) {
    return (
      <section className="hero relative h-[58vh] min-h-[420px] w-full overflow-hidden bg-background">
        <div className="absolute inset-0 gradient-hero" />
        <div className="relative z-10 h-full max-w-7xl mx-auto px-4 md:px-8 flex flex-col pt-28 md:pt-32 pb-20 md:pb-28">
          <div className="max-w-2xl mt-auto animate-fade-up">
            <span className="inline-flex items-center gap-[7px] rounded-full glass px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-md supports-[backdrop-filter]:bg-white/10">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {labels.heroBadge}
            </span>
            <h2 className="mt-4 font-display text-3xl md:text-4xl lg:text-5xl font-bold leading-[1.05] tracking-tight">
              {labels.brandName}
            </h2>
            <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-xl">
              Loading the latest 18+ embedded catalog…
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero relative h-[78vh] min-h-[520px] w-full overflow-hidden">
      {(() => {
        const v = slides[safeIdx];
        return (
          <div key={v.id} className="absolute inset-0 transition-opacity duration-1000">
            <img
              src={v.thumbnail}
              alt={v.title}
              width={1280}
              height={720}
              loading="eager"
              decoding="async"
              fetchPriority="high"
              className="h-full w-full object-cover scale-105"
              onError={(e) => {
                const t = e.currentTarget;
                if (!t.src.includes("hqdefault"))
                  t.src = v.thumbnail.replace("maxresdefault", "hqdefault");
              }}
            />
            <div className="hero-wash absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
            <div className="absolute inset-0 gradient-hero" />
          </div>
        );
      })()}

      <div className="relative z-10 h-full max-w-7xl mx-auto px-4 md:px-8 flex flex-col pt-28 md:pt-32 pb-20 md:pb-28">
        <div className="max-w-2xl mt-auto">
          {/* Pill is intentionally OUTSIDE the keyed slide container so it never
              unmounts / re-animates on dot click — fixes "pill disappears after click" */}
          <span className="inline-flex items-center gap-[7px] rounded-full glass px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-md supports-[backdrop-filter]:bg-white/10">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {labels.heroBadge}
          </span>
          <div key={slides[safeIdx].id} className="animate-fade-up">
            <h2 className="mt-4 font-display text-3xl md:text-4xl lg:text-5xl font-bold leading-[1.05] tracking-tight line-clamp-2">
              {slides[safeIdx].title}
            </h2>
            <p className="mt-4 text-base md:text-lg text-muted-foreground line-clamp-2 max-w-xl">
              {slides[safeIdx].description}
            </p>
            <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>{formatViews(slides[safeIdx].views)} views</span>
              <span>•</span>
              <span>{slides[safeIdx].duration}</span>
              <span>•</span>
              <span className="uppercase tracking-wider">{slides[safeIdx].category}</span>
            </div>

            <div className="mt-7 flex items-center gap-3">
              <Link
                to={watchPathFor(slides[safeIdx])}
                className="inline-flex items-center gap-2 rounded-full gradient-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform cursor-pointer"
              >
                <Play className="h-5 w-5 fill-current" /> {labels.heroCtaPlay}
              </Link>
              <Link
                to={watchPathFor(slides[safeIdx])}
                className="inline-flex items-center gap-2 rounded-full glass px-6 py-3 font-semibold hover:bg-secondary transition-colors cursor-pointer backdrop-blur-md"
              >
                <Info className="h-5 w-5" /> {labels.heroCtaInfo}
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* dots — auto-scroll is 5s, manual click resets the 5s timeout; glass card and spacing removed per Image 1 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-[7px]">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === safeIdx ? "true" : undefined}
            className="flex items-center justify-center cursor-pointer touch-manipulation shrink-0 py-2"
          >
            <span
              aria-hidden
              className={`block h-1.5 rounded-full transition-all duration-300 ${
                i === safeIdx ? "w-8 gradient-primary shadow-glow" : "w-4 bg-foreground/30"
              }`}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

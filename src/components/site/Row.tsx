import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { type Video } from "@/data/videos";
import { VideoCard } from "./VideoCard";

// Persist horizontal scroll positions per row title so they survive
// SPA navigation (home → /watch → back). Without this, the rows reset
// to the first item every time the user returns to the homepage.
const rowScrollStore = new Map<string, number>();

export function Row({
  title,
  videos,
  accent,
  animateCards = true,
}: {
  title: string;
  videos: Video[];
  accent?: boolean;
  animateCards?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const storageKey = title;

  // Restore the saved horizontal scroll position on mount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = rowScrollStore.get(storageKey);
    if (saved != null) {
      // Defer one frame so the DOM has laid out the cards before we scroll.
      requestAnimationFrame(() => {
        el.scrollLeft = saved;
      });
    }
  }, [storageKey]);

  // Save scroll position continuously (throttled via rAF).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        rowScrollStore.set(storageKey, el.scrollLeft);
        ticking = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [storageKey]);

  const scrollBy = (dir: 1 | -1) => {
    ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <section className="max-w-7xl mx-auto px-4 md:px-8 mt-12">
      <div className="flex items-end justify-between mb-5">
        <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
          {accent ? <span className="text-gradient">{title}</span> : title}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => scrollBy(-1)}
            className="h-10 w-10 rounded-full glass flex items-center justify-center hover:gradient-primary hover:text-primary-foreground transition-all"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            className="h-10 w-10 rounded-full glass flex items-center justify-center hover:gradient-primary hover:text-primary-foreground transition-all"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="flex gap-5 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 md:-mx-8 md:px-8"
      >
        {videos.map((v) => (
          <div key={v.id} className="shrink-0 w-[280px] md:w-[340px]">
            <VideoCard video={v} animate={animateCards} />
          </div>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";

/**
 * Infinite scroll hook. Reveals `step` more items each time the sentinel
 * scrolls into view, capped at `total`.
 *
 * When a `cacheKey` is provided, the revealed count and scroll position are
 * persisted in sessionStorage so that navigating back to the page (e.g. from
 * a /watch/:slug detail page) restores the previous list state instead of
 * collapsing back to the initial page size.
 */
export function useInfiniteList(total: number, step = 8, initial = 12, cacheKey?: string) {
  const storageKey = cacheKey ? `infinite-list:${cacheKey}` : null;

  const readCached = (): number | null => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const n = Number(JSON.parse(raw).count);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };

  const [count, setCount] = useState(() => {
    const cached = readCached();
    const start = cached ?? initial;
    return Math.min(start, Math.max(total, start));
  });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const lastKeyRef = useRef<string | null>(storageKey);

  // When totals shrink below cached count, clamp; when key changes, reset.
  useEffect(() => {
    if (lastKeyRef.current !== storageKey) {
      lastKeyRef.current = storageKey;
      const cached = readCached();
      setCount(Math.min(cached ?? initial, Math.max(total, cached ?? initial)));
      return;
    }
    setCount((c) => Math.min(Math.max(c, Math.min(initial, total)), Math.max(total, c)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, initial, storageKey]);

  // Persist current count so back-nav restores it.
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ count }));
    } catch {
      /* ignore */
    }
  }, [count, storageKey]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setCount((c) => Math.min(c + step, total));
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [step, total]);

  return { count, sentinelRef, done: count >= total };
}

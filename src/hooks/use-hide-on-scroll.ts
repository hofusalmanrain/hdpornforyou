import { useEffect, useRef, useState } from "react";

type Options = {
  threshold?: number;
  hideAfter?: number;
  disabled?: boolean;
};

/**
 * Hide on scroll down, show on scroll up — with rAF throttling and a
 * small dead-zone so micro-scrolls don't flicker.
 *
 * - Top `hideAfter` px always visible (so hero top isn't hidden).
 * - Down-scroll > `threshold` hides, up-scroll > threshold shows.
 * - When `disabled` is true the bar stays visible (e.g. menu open).
 */
export function useHideOnScroll({ threshold = 6, hideAfter = 64, disabled = false }: Options = {}) {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // When disabled (menu/search open) force visible and freeze tracking.
    if (disabled) {
      setVisible(true);
      return;
    }

    lastY.current = window.scrollY;

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const cur = window.scrollY;
        const diff = cur - lastY.current;

        if (cur <= hideAfter) {
          // Near top — always show so hero + top content is reachable.
          setVisible(true);
        } else if (diff > threshold) {
          setVisible(false);
        } else if (diff < -threshold) {
          setVisible(true);
        }

        lastY.current = cur;
        ticking.current = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, hideAfter, disabled]);

  return visible;
}

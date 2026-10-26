import { useEffect, useId } from "react";

declare global {
  interface Window {
    TsMasterSpot?: (options: { spot: string; containerId: string }) => void;
  }
}

interface TrafficStarsSpotProps {
  spot: string;
  className?: string;
  style?: React.CSSProperties;
}

export function TrafficStarsSpot({ spot, className = "", style }: TrafficStarsSpotProps) {
  const rawId = useId();
  const containerId = `ts-spot-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!spot) return;
    const container = document.getElementById(containerId);
    if (container) container.replaceChildren();
    let cancelled = false;
    let timer: number | undefined;
    const start = Date.now();
    const initialize = () => {
      if (cancelled) return;
      if (window.TsMasterSpot) {
        try {
          window.TsMasterSpot({ spot, containerId });
        } catch {
          /* Provider errors must not break the page. */
        }
        return;
      }
      if (Date.now() - start < 10_000) {
        timer = window.setTimeout(initialize, 100);
      }
    };
    initialize();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      container?.replaceChildren();
    };
  }, [containerId, spot]);

  return <div id={containerId} className={className} style={style} />;
}

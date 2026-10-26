import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

export function startRouteProgress() {
  window.dispatchEvent(new CustomEvent("hdpornforyou:route-progress"));
}

// Module-level elements + state so the popstate/navigate listeners (registered
// at import time, BEFORE React Router's history listener) can drive the bar
// synchronously, without waiting for React commits.
const els = { wrap: null as HTMLElement | null, bar: null as HTMLElement | null, ind: null as HTMLElement | null };
let started = false;
let mode: "none" | "indeterminate" | "percent" = "none";
let timers: { trickle?: number; reset?: number; safety?: number } = {};

function show() {
  if (!els.wrap) return;
  els.wrap.style.transition = "none";
  els.wrap.style.opacity = "1";
}

function hide() {
  if (!els.wrap) return;
  els.wrap.style.transition = "opacity 0.3s ease";
  els.wrap.style.opacity = "0";
}

// Indeterminate mode: a pure CSS transform keyframe sweep that the compositor
// keeps animating even while the main thread is blocked by the router's
// synchronous render of the previous page. It is composited from page load
// (always running, invisible), so the only main-thread work at trigger time is
// an opacity flip.
function startIndeterminate() {
  if (started || !els.wrap) return;
  started = true;
  mode = "indeterminate";
  window.clearInterval(timers.trickle);
  window.clearTimeout(timers.reset);
  window.clearTimeout(timers.safety);
  els.bar.style.opacity = "0";
  els.bar.style.transform = "translate3d(-92%, 0, 0)";
  els.ind.style.opacity = "1";
  show();
  timers.safety = window.setTimeout(() => finishIndeterminate(), 10000);
}

function finishIndeterminate() {
  if (mode !== "indeterminate" || !els.wrap) return;
  window.clearTimeout(timers.safety);
  mode = "percent";
  els.ind.style.opacity = "0";
  els.bar.style.opacity = "1";
  runPercent();
}

function runPercent() {
  const bar = els.bar;
  if (!bar) return;
  const t = timers;
  window.clearInterval(t.trickle);
  window.clearTimeout(t.reset);
  bar.style.transition = "transform 200ms linear";
  bar.style.transform = "translate3d(-92%, 0, 0)";
  // NProgress-style trickle: small, slowing increments on an interval so the
  // 200ms linear transform transition can glide between steps.
  let progress = 0.08;
  t.trickle = window.setInterval(() => {
    if (mode !== "percent") return;
    progress = Math.min(0.9, progress + (0.9 - progress) * 0.1);
    bar.style.transform = `translate3d(-${(1 - progress) * 100}%, 0, 0)`;
  }, 150);
  t.reset = window.setTimeout(() => {
    window.clearInterval(t.trickle);
    bar.style.transform = "translate3d(0, 0, 0)";
    t.reset = window.setTimeout(() => {
      started = false;
      mode = "none";
      hide();
      bar.style.transform = "translate3d(-92%, 0, 0)";
    }, 300);
  }, 800);
}

function startPercent() {
  if (started || !els.wrap) return;
  started = true;
  mode = "percent";
  window.clearTimeout(timers.safety);
  els.ind.style.opacity = "0";
  show();
  runPercent();
}

// Browser back/forward: the Navigation API fires the `navigate` event
// immediately on the button press, long before popstate is dispatched (which
// the browser queues only after settling the traversal — on a busy main
// thread that can be seconds late). Indeterminate mode runs on the compositor,
// so the bar is visible while the router re-renders the previous page.
function onTraverse() {
  if (mode === "none") startIndeterminate();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", onTraverse);
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener("navigate", (e: Event) => {
    const type = (e as { navigationType?: string }).navigationType;
    if (type === "traverse") onTraverse();
  });
}

export function RouteProgress() {
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  const prevKey = useRef(location.key);

  useEffect(() => {
    els.wrap = wrapRef.current;
    els.bar = barRef.current;
    els.ind = indRef.current;
    return () => {
      els.wrap = null;
      els.bar = null;
      els.ind = null;
    };
  }, []);

  // Start the bar the instant a link is clicked, before the router commits
  // the new route. Bubble phase: VideoCard's drag-guard stops propagation,
  // so drag/scroll releases never trigger the bar.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("//")) return;
      if (a.getAttribute("target")) return;
      if (a.hasAttribute("download")) return;
      if (href.startsWith("/api/")) return;
      if (mode === "none") startPercent();
    };
    const onCustom = () => {
      if (mode === "none") startPercent();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("hdpornforyou:route-progress", onCustom);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hdpornforyou:route-progress", onCustom);
    };
  }, []);

  // The route commit is the moment the new page is rendered: finish an
  // in-flight indeterminate sweep with the percentage run. Also acts as a
  // fallback for programmatic navigations (navigate()): if nothing started
  // the bar, start it once the new route is committed. Keyed on a previous-key
  // ref so StrictMode's double-invoke of the mount effect never fires it.
  useEffect(() => {
    if (prevKey.current !== location.key) {
      prevKey.current = location.key;
      if (mode === "indeterminate") finishIndeterminate();
      else if (!started) startPercent();
    }
  }, [location.key]);

  return (
    <div ref={wrapRef} aria-hidden className="route-progress" style={{ opacity: 0 }}>
      <div ref={barRef} className="route-progress-bar">
        <span className="route-progress-peg" />
      </div>
      <div ref={indRef} className="route-progress-indeterminate" aria-hidden>
        <span className="route-progress-inc" />
        <span className="route-progress-dec" />
      </div>
    </div>
  );
}
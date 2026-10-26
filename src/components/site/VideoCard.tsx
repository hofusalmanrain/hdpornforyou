import { Link } from "react-router";
import { Play, Eye, ThumbsUp } from "lucide-react";
import { useRef, useState } from "react";
import { formatViews, formatDuration, watchPathFor, type Video } from "@/data/videos";
import { saveScrollPosition } from "@/lib/scroll-memory";

const loadedThumbnails = new Set<string>();

interface Props {
  video: Video;
  size?: "default" | "compact";
  animate?: boolean;
}

export function VideoCard({ video, size = "default", animate = true }: Props) {
  const [loaded, setLoaded] = useState(() => loadedThumbnails.has(video.thumbnail));
  const pointerRef = useRef<{ x: number; y: number; scrollY: number } | null>(null);

  const markPointerStart = (x: number, y: number) => {
    saveScrollPosition();
    pointerRef.current = { x, y, scrollY: window.scrollY };
  };

  const isDragOrScroll = (x: number, y: number) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start) return false;
    const moved = Math.hypot(x - start.x, y - start.y);
    const scrolled = Math.abs(window.scrollY - start.scrollY);
    return moved > 10 || scrolled > 4;
  };

  return (
    <Link
      to={watchPathFor(video)}
      state={{ video }}
      draggable={false}
      onPointerDown={(e) => markPointerStart(e.clientX, e.clientY)}
      onPointerCancel={() => {
        pointerRef.current = null;
      }}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => {
        if (isDragOrScroll(e.clientX, e.clientY)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        saveScrollPosition();
      }}
      className={animate ? "group block animate-fade-up" : "group block"}
    >
      <div className="relative overflow-hidden rounded-2xl gradient-card shadow-card transition-transform duration-500 group-hover:shadow-glow group-hover:-translate-y-1">
        <div className="relative aspect-video overflow-hidden bg-muted">
          {!loaded && <div className="absolute inset-0 shimmer" />}
          <img
            src={video.thumbnail}
            alt={video.title}
            width={640}
            height={360}
            loading="lazy"
            decoding="async"
            onLoad={() => {
              loadedThumbnails.add(video.thumbnail);
              setLoaded(true);
            }}
            onError={(e) => {
              // Fallback to hqdefault if maxres missing
              const target = e.currentTarget;
              if (!target.src.includes("hqdefault")) {
                target.src = video.thumbnail.replace("maxresdefault", "hqdefault");
                loadedThumbnails.add(target.src);
              }
            }}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />

          {/* gradient overlay */}
          <div className="card-wash absolute inset-0 bg-gradient-to-t from-background/90 via-background/0 to-background/0 opacity-60" />

          {/* badges */}
          <div className="absolute top-2.5 left-2.5 flex gap-1.5">
            {video.trending && (
              <span className="rounded-full gradient-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-glow">
                Trending
              </span>
            )}
            {video.hd && (
              <span className="rounded-full glass px-2 py-0.5 text-[10px] font-bold tracking-wider">
                HD
              </span>
            )}
          </div>
          <span className="absolute bottom-2.5 right-2.5 rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium tabular-nums">
            {formatDuration(video.duration)}
          </span>

          {/* play icon */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="h-14 w-14 rounded-full gradient-primary flex items-center justify-center shadow-glow scale-75 group-hover:scale-100 transition-transform duration-300">
              <Play className="h-6 w-6 text-primary-foreground fill-current ml-0.5" />
            </div>
          </div>
        </div>

        <div className={size === "compact" ? "p-3" : "p-4"}>
          <h3 className="font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {video.title}
          </h3>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">{video.channel}</span>
            <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-[10px] uppercase tracking-wider">
              {video.category}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" /> {formatViews(video.views)}
            </span>
            <span className="flex items-center gap-1">
              <ThumbsUp className="h-3 w-3" /> {formatViews(video.likes)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

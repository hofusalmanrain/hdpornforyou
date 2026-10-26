import { useEffect, useState } from "react";
import { Activity, Eye, Users, TrendingUp } from "lucide-react";

interface LiveData {
  now: string;
  active1m: number;
  active5m: number;
  views1h: number;
  views24h: number;
  topPaths: { path: string; hits: number }[];
  perMinute: { minute: string; hits: number }[];
}

export function LiveTraffic() {
  const [data, setData] = useState<LiveData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/analytics/live", { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (alive) {
          setData(j);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr(String((e as Error).message));
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (err)
    return (
      <div className="glass rounded-2xl p-6 text-sm text-destructive">Failed to load: {err}</div>
    );
  if (!data)
    return (
      <div className="glass rounded-2xl p-6 text-sm text-muted-foreground">
        Loading live traffic…
      </div>
    );

  const maxHits = Math.max(1, ...data.perMinute.map((p) => p.hits));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          icon={<Users className="h-5 w-5" />}
          label="Active (1m)"
          value={data.active1m}
          accent
        />
        <Stat icon={<Activity className="h-5 w-5" />} label="Active (5m)" value={data.active5m} />
        <Stat icon={<Eye className="h-5 w-5" />} label="Views (1h)" value={data.views1h} />
        <Stat icon={<TrendingUp className="h-5 w-5" />} label="Views (24h)" value={data.views24h} />
      </div>

      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-lg font-semibold mb-4">Pageviews — last 30 minutes</h3>
        <div className="flex items-end gap-1 h-32">
          {data.perMinute.length === 0 && (
            <p className="text-sm text-muted-foreground self-center">No data yet.</p>
          )}
          {data.perMinute.map((p) => (
            <div
              key={p.minute}
              className="flex-1 bg-primary/70 rounded-t hover:bg-primary transition-colors"
              style={{ height: `${(p.hits / maxHits) * 100}%` }}
              title={`${p.minute} — ${p.hits} views`}
            />
          ))}
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <h3 className="font-display text-lg font-semibold mb-4">Top pages (24h)</h3>
        <div className="space-y-2">
          {data.topPaths.length === 0 && (
            <p className="text-sm text-muted-foreground">No pageviews recorded yet.</p>
          )}
          {data.topPaths.map((p) => (
            <div
              key={p.path}
              className="flex items-center justify-between rounded-lg bg-secondary/40 px-4 py-2 text-sm"
            >
              <span className="truncate font-mono">{p.path || "/"}</span>
              <span className="text-muted-foreground tabular-nums">{p.hits}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Auto-refreshes every 5 seconds · traffic events are kept for 30 days · last update{" "}
        {new Date(data.now).toLocaleTimeString()}
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`glass rounded-2xl p-5 ${accent ? "ring-2 ring-primary/40" : ""}`}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

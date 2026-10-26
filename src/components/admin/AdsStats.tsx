/**
 * Performance dashboard for ad zones.
 *
 * Backed entirely by GET /api/ads/stats. No browser storage.
 */

import { useEffect, useMemo, useState } from "react";
import { BarChart3, MousePointerClick, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";

interface ZoneRow {
  zone: string;
  format: string | null;
  event: string;
  count: number;
}
interface StatsResponse {
  totals: ZoneRow[];
  daily: { day: string; event: string; count: number }[];
  total: { event: string; count: number }[];
}

export function AdsStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverDown, setServerDown] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get<StatsResponse>("/api/ads/stats");
      setServerDown(false);
      setStats(r);
    } catch {
      setServerDown(true);
      setStats(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const byZone = useMemo(() => {
    if (!stats) return [];
    const map = new Map<
      string,
      { zone: string; format: string | null; impressions: number; clicks: number }
    >();
    for (const r of stats.totals) {
      const key = `${r.zone}::${r.format ?? ""}`;
      const cur = map.get(key) ?? { zone: r.zone, format: r.format, impressions: 0, clicks: 0 };
      if (r.event === "impression") cur.impressions += r.count;
      else if (r.event === "click") cur.clicks += r.count;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.impressions - a.impressions);
  }, [stats]);

  const totals = useMemo(() => {
    const result = { impressions: 0, clicks: 0 };
    if (stats) {
      for (const r of stats.total) {
        if (r.event === "impression") result.impressions = r.count;
        else if (r.event === "click") result.clicks = r.count;
      }
    }
    return result;
  }, [stats]);

  const ctr = totals.impressions ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0.00";

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Ads performance
          </h2>
          <p className="text-sm text-muted-foreground">
            Impression and click counts from the last 30 days, served from the PostgreSQL{" "}
            <code className="text-primary">ad_events</code> table. Older rows are deleted
            automatically.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {serverDown && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-sm text-yellow-200 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          <div>
            <p className="font-semibold">Backend unreachable</p>
            <p className="text-xs">
              Start the Express and PostgreSQL services to collect cross-session analytics.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Impressions (30d)"
          value={totals.impressions}
          icon={<Eye className="h-4 w-4" />}
        />
        <StatCard
          label="Clicks (30d)"
          value={totals.clicks}
          icon={<MousePointerClick className="h-4 w-4" />}
        />
        <StatCard label="CTR" value={`${ctr}%`} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      {stats && byZone.length > 0 && (
        <section>
          <h3 className="font-display text-lg font-bold mb-3">By zone</h3>
          <div className="rounded-2xl gradient-card shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Zone</th>
                  <th className="text-left p-3">Format</th>
                  <th className="text-right p-3">Impressions</th>
                  <th className="text-right p-3">Clicks</th>
                  <th className="text-right p-3">CTR</th>
                </tr>
              </thead>
              <tbody>
                {byZone.map((r) => {
                  const zoneCtr = r.impressions
                    ? ((r.clicks / r.impressions) * 100).toFixed(2)
                    : "0.00";
                  return (
                    <tr key={`${r.zone}-${r.format ?? ""}`} className="border-t border-border">
                      <td className="p-3 font-mono text-xs truncate max-w-[280px]">{r.zone}</td>
                      <td className="p-3 text-xs text-muted-foreground">{r.format ?? "—"}</td>
                      <td className="p-3 text-right tabular-nums">
                        {r.impressions.toLocaleString()}
                      </td>
                      <td className="p-3 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums">{zoneCtr}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stats && stats.daily.length > 0 && (
        <section>
          <h3 className="font-display text-lg font-bold mb-3">Last 30 days</h3>
          <DailyChart daily={stats.daily} />
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl gradient-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon} {label}
      </div>
      <p className="mt-2 font-display text-3xl font-bold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function DailyChart({ daily }: { daily: { day: string; event: string; count: number }[] }) {
  const days = useMemo(() => {
    const map = new Map<string, { day: string; impressions: number; clicks: number }>();
    for (const r of daily) {
      const cur = map.get(r.day) ?? { day: r.day, impressions: 0, clicks: 0 };
      if (r.event === "impression") cur.impressions = r.count;
      if (r.event === "click") cur.clicks = r.count;
      map.set(r.day, cur);
    }
    return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }, [daily]);

  const max = Math.max(1, ...days.map((d) => Math.max(d.impressions, d.clicks)));

  return (
    <div className="rounded-2xl gradient-card p-5 shadow-card">
      <div className="flex items-end gap-1 h-40">
        {days.map((d) => (
          <div
            key={d.day}
            className="flex-1 flex flex-col items-center gap-0.5"
            title={`${d.day}: ${d.impressions} imp / ${d.clicks} clk`}
          >
            <div
              className="w-full bg-primary/70 rounded-t"
              style={{ height: `${(d.impressions / max) * 100}%` }}
            />
            <div className="w-full bg-accent/70" style={{ height: `${(d.clicks / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 bg-primary/70 inline-block rounded-sm" /> Impressions
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 bg-accent/70 inline-block rounded-sm" /> Clicks
        </span>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import { setTheme, THEME_PRESETS } from "@/lib/theme-store";
import { useTheme } from "@/hooks/use-theme";

export function ThemeEditor() {
  const current = useTheme();
  const [primary, setPrimary] = useState(current.primary);
  const [accent, setAccent] = useState(current.accent);

  const apply = (p: string, a: string) => {
    setPrimary(p);
    setAccent(a);
    setTheme({ primary: p, accent: a });
  };

  return (
    <div className="rounded-2xl gradient-card p-6 shadow-card space-y-6">
      <div>
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" /> Theme color
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Live-update brand colors across the entire platform.
        </p>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Presets</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {THEME_PRESETS.map((p) => {
            const active = p.primary.toLowerCase() === primary.toLowerCase();
            return (
              <button
                key={p.name}
                onClick={() => apply(p.primary, p.accent)}
                className={`text-left rounded-xl p-3 border transition-all ${active ? "border-primary shadow-glow" : "border-border hover:border-primary/40"}`}
              >
                <div className="flex gap-1.5 h-8 rounded-md overflow-hidden">
                  <span className="flex-1" style={{ background: p.primary }} />
                  <span className="flex-1" style={{ background: p.accent }} />
                </div>
                <p className="mt-2 text-sm font-semibold">{p.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{p.primary}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Custom</p>
        <div className="grid grid-cols-2 gap-4">
          <ColorField label="Primary" value={primary} onChange={(v) => apply(v, accent)} />
          <ColorField label="Accent" value={accent} onChange={(v) => apply(primary, v)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => apply(THEME_PRESETS[0].primary, THEME_PRESETS[0].accent)}
          className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
        >
          <RotateCcw className="h-4 w-4" /> Reset
        </button>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg bg-background border border-border focus-within:border-primary/60 px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md bg-transparent border-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-sm font-mono outline-none"
        />
      </div>
    </label>
  );
}

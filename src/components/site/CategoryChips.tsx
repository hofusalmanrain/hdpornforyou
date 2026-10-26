import { useCategories } from "@/hooks/use-categories";

export function CategoryChips({
  active,
  onChange,
}: {
  active: string;
  onChange: (slug: string) => void;
}) {
  const categories = useCategories();
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 mt-10">
      <div className="chip-row flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {categories.map((c) => {
          const isActive = active === c.slug;
          return (
            <button
              key={c.slug}
              onClick={() => onChange(c.slug)}
              className={[
                "shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all border",
                isActive
                  ? "gradient-primary text-primary-foreground border-primary/50 shadow-[0_4px_14px_-6px_var(--glow)]"
                  : "glass text-muted-foreground hover:text-foreground border-border",
              ].join(" ")}
            >
              <span>{c.icon}</span>
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

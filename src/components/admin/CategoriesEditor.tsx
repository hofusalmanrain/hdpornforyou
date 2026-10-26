import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Pencil, X, Check as CheckIcon, Layers } from "lucide-react";
import { useCategories } from "@/hooks/use-categories";
import {
  saveCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  type Category,
} from "@/lib/categories-store";

/**
 * Admin tab: add, edit and delete site categories.
 * The full list is persisted to the backend via PUT /api/categories.
 * The seed "all" pseudo-category is always re-inserted at the head
 * by the store, so it cannot be deleted or renamed here.
 */
export function CategoriesEditor() {
  const all = useCategories();
  const editable = all.filter((c) => c.slug !== "all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Category>({ slug: "", name: "", icon: "🎬" });
  const [newCat, setNewCat] = useState<Category>({ slug: "", name: "", icon: "🎬" });

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  const flash = (m: string) => setMsg(m);

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

  const onAdd = async () => {
    const name = newCat.name.trim();
    if (!name) {
      flash("Name is required.");
      return;
    }
    const slug = newCat.slug.trim() ? slugify(newCat.slug) : slugify(name);
    if (!slug) {
      flash("Slug is required.");
      return;
    }
    if (slug === "all") {
      flash('Slug "all" is reserved.');
      return;
    }
    if (editable.some((c) => c.slug === slug)) {
      flash(`Slug "${slug}" already exists.`);
      return;
    }
    setBusy(true);
    try {
      await addCategory({ slug, name, icon: newCat.icon || "📁" });
      setNewCat({ slug: "", name: "", icon: "🎬" });
      flash(`Added "${name}".`);
    } catch (e) {
      flash(`Failed to add: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c: Category) => {
    setEditingSlug(c.slug);
    setDraft({ ...c });
  };

  const cancelEdit = () => {
    setEditingSlug(null);
  };

  const saveEdit = async () => {
    if (!editingSlug) return;
    const name = draft.name.trim();
    const newSlug = draft.slug.trim() ? slugify(draft.slug) : slugify(name);
    if (!name) {
      flash("Name is required.");
      return;
    }
    if (!newSlug) {
      flash("Slug is required.");
      return;
    }
    if (newSlug === "all") {
      flash('Slug "all" is reserved.');
      return;
    }
    if (newSlug !== editingSlug && editable.some((c) => c.slug === newSlug)) {
      flash(`Slug "${newSlug}" already exists.`);
      return;
    }
    setBusy(true);
    try {
      await updateCategory(editingSlug, { slug: newSlug, name, icon: draft.icon || "📁" });
      setEditingSlug(null);
      flash(`Saved "${name}".`);
    } catch (e) {
      flash(`Failed to save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (c: Category) => {
    if (
      !confirm(
        `Delete category "${c.name}"? Videos in this category will keep their slug but the chip disappears.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteCategory(c.slug);
      flash(`Deleted "${c.name}".`);
    } catch (e) {
      flash(`Failed to delete: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= editable.length) return;
    const next = [...editable];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    setBusy(true);
    try {
      await saveCategories(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" /> Categories
          </h2>
          {msg && (
            <span className="text-xs font-semibold text-primary inline-flex items-center gap-1">
              <Save className="h-3.5 w-3.5" /> {msg}
            </span>
          )}
        </header>
        <p className="text-sm text-muted-foreground">
          Categories power the chips on the homepage, the explore page, and the per-category routes
          like <code className="text-foreground/80">/category/&lt;slug&gt;</code>. The pinned
          <b> All</b> entry is automatic and cannot be removed.
        </p>

        {/* Add new */}
        <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-3">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
            Add new category
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[64px_1fr_1fr_auto] gap-2 items-end">
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Icon
              </span>
              <input
                value={newCat.icon}
                onChange={(e) => setNewCat({ ...newCat, icon: e.target.value })}
                maxLength={4}
                className="mt-1 w-full rounded-lg bg-background border border-border px-2 py-2 text-center text-lg outline-none focus:border-primary/60"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Name
              </span>
              <input
                value={newCat.name}
                onChange={(e) =>
                  setNewCat({
                    ...newCat,
                    name: e.target.value,
                    slug: newCat.slug || slugify(e.target.value),
                  })
                }
                placeholder="e.g. Documentaries"
                className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Slug
              </span>
              <input
                value={newCat.slug}
                onChange={(e) => setNewCat({ ...newCat, slug: e.target.value })}
                placeholder="auto from name"
                className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60 font-mono"
              />
            </label>
            <button
              onClick={onAdd}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="p-3 text-left">#</th>
                <th className="p-3 text-left">Icon</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Slug</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {editable.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    No categories yet — add your first above.
                  </td>
                </tr>
              )}
              {editable.map((c, i) => {
                const editing = editingSlug === c.slug;
                return (
                  <tr key={c.slug} className="border-t border-border">
                    <td className="p-3 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="p-3 text-lg">
                      {editing ? (
                        <input
                          value={draft.icon}
                          onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                          maxLength={4}
                          className="w-14 rounded-md bg-background border border-border px-1 py-1 text-center text-lg outline-none focus:border-primary/60"
                        />
                      ) : (
                        c.icon
                      )}
                    </td>
                    <td className="p-3 font-medium">
                      {editing ? (
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="w-full rounded-md bg-background border border-border px-2 py-1 text-sm outline-none focus:border-primary/60"
                        />
                      ) : (
                        c.name
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {editing ? (
                        <input
                          value={draft.slug}
                          onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                          className="w-full rounded-md bg-background border border-border px-2 py-1 text-xs font-mono outline-none focus:border-primary/60"
                        />
                      ) : (
                        c.slug
                      )}
                    </td>
                    <td className="p-3 text-right space-x-1 whitespace-nowrap">
                      {editing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            disabled={busy}
                            className="rounded-md gradient-primary text-primary-foreground px-3 py-1 text-xs inline-flex items-center gap-1 disabled:opacity-40"
                          >
                            <CheckIcon className="h-3 w-3" /> Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-md glass px-3 py-1 text-xs inline-flex items-center gap-1 hover:bg-secondary"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => reorder(i, i - 1)}
                            disabled={i === 0 || busy}
                            className="rounded-md glass px-2 py-1 text-xs hover:bg-secondary disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => reorder(i, i + 1)}
                            disabled={i === editable.length - 1 || busy}
                            className="rounded-md glass px-2 py-1 text-xs hover:bg-secondary disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => startEdit(c)}
                            className="rounded-md glass px-3 py-1 text-xs inline-flex items-center gap-1 hover:bg-secondary"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            onClick={() => onDelete(c)}
                            className="rounded-md bg-destructive/20 text-destructive px-3 py-1 text-xs inline-flex items-center gap-1 hover:bg-destructive/30"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

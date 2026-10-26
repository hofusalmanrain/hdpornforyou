/**
 * Categories store — backed by /api/categories (JSON list in `settings`).
 *
 * Synchronous getters return the in-memory cache. `hydrateCategories()`
 * is called from store-bootstrap on app start; admin mutations call
 * `saveCategories()` which PUTs the whole list and refreshes the cache.
 *
 * Falls back to the seed list from `@/data/videos` until first hydrate so
 * existing pages don't render blank chips.
 */
import { categories as seedCategories } from "@/data/videos";
import { api } from "./api-client";

export interface Category {
  slug: string;
  name: string;
  icon: string;
}

const EVT = "hdpornforyou:categories-changed";
export const CATEGORIES_EVENT = EVT;

let cache: Category[] = [...seedCategories];
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

function normaliseSlug(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function withAll(list: Category[]): Category[] {
  // Always keep a pinned "all" pseudo-category at the head — many components
  // assume it exists. It is filtered out wherever real categories are listed.
  const filtered = list.filter((c) => c.slug !== "all");
  const all = list.find((c) => c.slug === "all") || { slug: "all", name: "All", icon: "✨" };
  return [all, ...filtered];
}

export async function hydrateCategories(): Promise<Category[]> {
  try {
    const res = await api.get<{ categories: Category[] | unknown }>("/api/categories");
    const list = Array.isArray(res.categories) ? (res.categories as Category[]) : [];
    cache = withAll(list.length ? list : seedCategories);
  } catch {
    cache = withAll(seedCategories);
  }
  hydrated = true;
  emit();
  return cache;
}

export function getCategories(): Category[] {
  if (!hydrated && typeof window !== "undefined") {
    hydrateCategories().catch(() => {});
  }
  return cache;
}

/** Categories minus the "all" pseudo-entry — for editors and selects. */
export function getRealCategories(): Category[] {
  return getCategories().filter((c) => c.slug !== "all");
}

export async function saveCategories(list: Category[]) {
  // Strip the "all" pseudo and re-add it on read.
  const clean = withAll(
    list
      .map((c) => ({
        slug: normaliseSlug(c.slug || c.name),
        name: String(c.name || "").trim(),
        icon: String(c.icon || "📁"),
      }))
      .filter((c) => c.slug && c.name && c.slug !== "all"),
  );
  await api.put("/api/categories", {
    categories: clean.filter((c) => c.slug !== "all"),
  });
  cache = clean;
  emit();
}

export async function addCategory(c: Category) {
  const next = getRealCategories().concat([c]);
  await saveCategories(next);
}

export async function updateCategory(originalSlug: string, c: Category) {
  const next = getRealCategories().map((x) => (x.slug === originalSlug ? c : x));
  await saveCategories(next);
}

export async function deleteCategory(slug: string) {
  const next = getRealCategories().filter((c) => c.slug !== slug);
  await saveCategories(next);
}

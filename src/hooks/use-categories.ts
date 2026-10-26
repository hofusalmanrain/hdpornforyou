import { useEffect, useState } from "react";
import {
  CATEGORIES_EVENT,
  getCategories,
  hydrateCategories,
  type Category,
} from "@/lib/categories-store";

/** Reactive subscription to the categories store. */
export function useCategories(): Category[] {
  const [list, setList] = useState<Category[]>(() => getCategories());
  useEffect(() => {
    const sync = () => setList(getCategories());
    window.addEventListener(CATEGORIES_EVENT, sync);
    hydrateCategories().catch(() => {});
    return () => window.removeEventListener(CATEGORIES_EVENT, sync);
  }, []);
  return list;
}

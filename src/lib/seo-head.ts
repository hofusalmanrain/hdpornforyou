export function absoluteUrl(base: string, value?: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `${base.replace(/\/$/, "")}/${v.replace(/^\/+/, "")}`;
}

export function removeJsonLdByTypes(types: string[]): void {
  if (typeof document === "undefined") return;
  const wanted = new Set(types);
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    try {
      const parsed = JSON.parse(node.textContent || "null");
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (list.some((entry) => entry && wanted.has(String(entry["@type"] || "")))) {
        node.remove();
      }
    } catch {}
  });
}

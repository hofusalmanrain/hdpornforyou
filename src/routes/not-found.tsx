import { useEffect } from "react";
import { Link } from "react-router";
import { useLabels } from "@/hooks/use-labels";

export default function NotFound() {
  const labels = useLabels();
  useEffect(() => {
    const prevTitle = document.title;
    const description = `The page you requested could not be found. Browse ${labels.brandName} for 18+ embedded videos, categories and tags.`;
    document.title = `Page not found | ${labels.brandName}`;
    let descEl = document.head.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    const prevDesc = descEl?.content || "";
    if (!descEl) {
      descEl = document.createElement("meta");
      descEl.name = "description";
      document.head.appendChild(descEl);
    }
    descEl.content = description;
    const upsert = (content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(
        'meta[name="robots"]',
      );
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", "robots");
        document.head.appendChild(el);
      }
      const prev = el.content;
      el.content = content;
      return prev;
    };
    const prev = upsert("noindex,follow");
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    // remove canonical for 404 to avoid pointing to itself as indexable
    if (link) link.remove();
    return () => {
      document.title = prevTitle;
      if (descEl) descEl.content = prevDesc;
      const el = document.head.querySelector<HTMLMetaElement>(
        'meta[name="robots"]',
      );
      if (el) el.content = prev || "index,follow";
    };
  }, [labels.brandName]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-8xl font-bold text-gradient">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page Not Found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

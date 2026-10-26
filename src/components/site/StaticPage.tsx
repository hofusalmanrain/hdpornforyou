import { ReactNode, useEffect } from "react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { MobileNav } from "@/components/site/MobileNav";
import { useLabels } from "@/hooks/use-labels";
import { getSeo } from "@/lib/seo-store";
import { absoluteUrl, removeJsonLdByTypes } from "@/lib/seo-head";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    if (props?.children) return extractText(props.children);
  }
  return "";
}

export function StaticPage({
  title,
  titleText,
  subtitle,
  children,
  canonicalPath,
  description,
}: {
  title: ReactNode;
  titleText?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  canonicalPath?: string;
  description?: string;
}) {
  const labels = useLabels();
  const fallbackExtracted = typeof title === "string" ? title : extractText(title);
  const titleStr = (titleText?.trim() || fallbackExtracted || "").trim();
  useEffect(() => {
    const path = canonicalPath || (typeof window !== "undefined" ? window.location.pathname : "");
    const subtitleStr = typeof subtitle === "string" ? subtitle : extractText(subtitle as ReactNode);
    const effectiveTitle = titleStr || subtitleStr || "Page";
    const fullTitle = `${effectiveTitle} | ${labels.brandName}`;
    document.title = fullTitle;
    const desc = description || subtitleStr || `${effectiveTitle} - ${labels.brandName} 18+ embedded streaming.`;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = String(desc).slice(0, 155);
    const upsert = (attr: "name" | "property", key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.content = content;
    };
    const seo = getSeo();
    const originBase = (seo.canonicalBase.trim() || window.location.origin).replace(/\/$/, "");
    const ogImg = absoluteUrl(originBase, seo.og.image || "/og-image.jpg");
    upsert("property", "og:title", fullTitle);
    upsert("property", "og:description", String(desc).slice(0, 155));
    upsert("property", "og:type", "website");
    upsert("property", "og:site_name", seo.og.siteName || labels.brandName);
    if (ogImg) {
      upsert("property", "og:image", ogImg);
      upsert("property", "og:image:width", "1200");
      upsert("property", "og:image:height", "630");
      upsert("property", "og:image:type", "image/jpeg");
      upsert("property", "og:image:alt", seo.og.imageAlt || fullTitle);
    }
    upsert("name", "twitter:card", seo.twitter.card || "summary_large_image");
    upsert("name", "twitter:site", seo.twitter.site || "@hdpornforyou");
    upsert("name", "twitter:creator", seo.twitter.creator || "@hdpornforyou");
    upsert("name", "twitter:title", fullTitle);
    upsert("name", "twitter:description", String(desc).slice(0, 155));
    if (ogImg) upsert("name", "twitter:image", seo.twitter.image || ogImg);
    upsert("name", "robots", "index,follow");
    let canonicalUrl = "";
    if (path) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
      }
      if (originBase) {
        link.href = `${originBase}${path}`;
        canonicalUrl = `${originBase}${path}`;
        upsert("property", "og:url", canonicalUrl);
      }
    }
    // Emit WebPage JSON-LD + BreadcrumbList
    removeJsonLdByTypes(["WebPage", "BreadcrumbList"]);
    const wpId = "ld-webpage-static";
    const bcId = "ld-breadcrumb-static";
    document.getElementById(wpId)?.remove();
    document.getElementById(bcId)?.remove();
    const urlForLd = canonicalUrl || `${originBase}${path || "/"}`;
    const wpScript = document.createElement("script");
    wpScript.id = wpId;
    wpScript.type = "application/ld+json";
    wpScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: fullTitle,
      description: String(desc).slice(0, 155),
      url: urlForLd,
      isPartOf: { "@type": "WebSite", name: labels.brandName, url: `${originBase}/` },
    });
    document.head.appendChild(wpScript);
    const bcScript = document.createElement("script");
    bcScript.id = bcId;
    bcScript.type = "application/ld+json";
    bcScript.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${originBase}/` },
        { "@type": "ListItem", position: 2, name: effectiveTitle, item: urlForLd },
      ],
    });
    document.head.appendChild(bcScript);
    return () => {
      document.getElementById(wpId)?.remove();
      document.getElementById(bcId)?.remove();
    };
  }, [titleStr, titleText, description, subtitle, canonicalPath, labels.brandName]);
  return (
    <div className="min-h-screen bg-background pb-32">
      <Navbar />
      <main className="pt-28 max-w-4xl mx-auto px-4 md:px-8 animate-fade-up">
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-3 text-muted-foreground text-lg">{subtitle}</p> : null}
        <div className="mt-10 prose prose-invert max-w-none text-foreground/90 space-y-6 leading-relaxed">
          {children}
        </div>
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}

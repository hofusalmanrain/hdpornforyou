import { Link } from "react-router";
import { useLabels } from "@/hooks/use-labels";
import { useBrandLogo } from "@/hooks/use-brand-logo";

type FooterLink = { label: string; to: string };

const exploreLinks: FooterLink[] = [
  { label: "Home", to: "/" },
  { label: "Trending", to: "/trending" },
  { label: "Categories", to: "/explore" },
  { label: "Latest", to: "/latest" },
];

const companyLinks: FooterLink[] = [
  { label: "About", to: "/about" },
  { label: "Careers", to: "/careers" },
  { label: "Contact", to: "/contact" },
  { label: "Press", to: "/press" },
];

const legalLinks: FooterLink[] = [
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "DMCA", to: "/dmca" },
  { label: "2257 Statement", to: "/2257" },
];

export function Footer() {
  const labels = useLabels();
  const brandLogoUrl = useBrandLogo();
  return (
    <footer className="mt-24 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 grid gap-8 md:grid-cols-4">
        <div>
          <div className="flex items-start gap-2">
            {brandLogoUrl ? (
              <img
                src={brandLogoUrl}
                alt={labels.brandName}
                width={56}
                height={56}
                className="-mt-7 h-14 w-14 md:h-16 md:w-16 rounded-xl object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="relative -mt-7 h-14 w-14 md:h-16 md:w-16 rounded-xl gradient-primary shadow-glow flex items-center justify-center">
                <span className="font-display text-xl md:text-2xl font-bold text-primary-foreground">
                  {labels.brandName.charAt(0)}
                </span>
              </div>
            )}
            <span className="font-display text-xl font-bold leading-none">
              {labels.brandName.slice(0, Math.ceil(labels.brandName.length / 2))}
              <span className="text-gradient">
                {labels.brandName.slice(Math.ceil(labels.brandName.length / 2))}
              </span>
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{labels.footerTagline}</p>
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
            All models were 18 years of age or older at the time of depiction.{" "}
            <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold tracking-wider">
              RTA
            </span>{" "}
            <a href="https://www.rtalabel.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              RTA
            </a>{" "}
            ·{" "}
            <a href="https://www.rtalabel.org/index.php?content=parents" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
              Parental Controls
            </a>
          </p>
        </div>
        <FooterCol title="Explore" links={exploreLinks} />
        <FooterCol title="Company" links={companyLinks} />
        <FooterCol title="Legal" links={legalLinks} />
      </div>
      <div className="border-t border-border py-6 text-center text-xs text-muted-foreground space-y-2 px-4">
        <p>
          © {new Date().getFullYear()} {labels.brandName}. All rights reserved. — 18+ Only. All
          content is embedded via Eporner API. We do not host any videos. All models are 18+.
        </p>
        <p className="text-[11px] leading-relaxed max-w-4xl mx-auto">
          Disclaimer: {labels.brandName} operates as an embed search engine. All videos, images, and
          thumbnails are served directly from{" "}
          <a href="https://www.eporner.com" target="_blank" rel="noopener noreferrer" className="underline">
            Eporner.com
          </a>{" "}
          via its official public API. We have no control over the content hosted there. If you find
          infringing or illegal content, please file a notice via our{" "}
          <a href="/dmca" className="underline">
            DMCA
          </a>{" "}
          and{" "}
          <a href="/2257" className="underline">
            2257
          </a>{" "}
          pages and with the host.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h4 className="font-semibold mb-3">{title}</h4>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="hover:text-primary transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { StaticPage } from "@/components/site/StaticPage";
import { useLabels } from "@/hooks/use-labels";

export default function AboutPage() {
  const labels = useLabels();
  return (
    <StaticPage
      title={
        <>
          About <span className="text-gradient">{labels.brandName}</span>
        </>
      }
      titleText={`About ${labels.brandName}`}
      subtitle="Adults 18+ only — A fast, embed-only video discovery platform."
    >
      <p>
        {labels.brandName} is a modern <strong>18+ embedded video search engine</strong> focused on
        speed, clean design, and honest infrastructure. We do not host or store any video files.
        Every stream you watch is embedded directly from <strong>Eporner.com</strong> via its
        official public API and played inside a secure iframe. Thumbnails are also served from
        Eporner&apos;s CDN.
      </p>
      <p>
        Our mission is simple: make 18+ content easy to discover and enjoyable on any device —
        without re-hosting, without deceptive claims, and with full respect for performers,
        copyright holders, and viewers.
      </p>
      <h2 className="text-2xl font-bold mt-8">Why embedded-only?</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong>Transparency:</strong> viewers always know the original host (Eporner) and where
          to report concerns.
        </li>
        <li>
          <strong>Compliance:</strong> the host remains responsible for licensing and 18 U.S.C. §
          2257 record-keeping — we link to their custodian.
        </li>
        <li>
          <strong>Performance:</strong> no re-encoding, no duplicate bandwidth — streams load fast
          and work everywhere.
        </li>
      </ul>
      <h2 className="text-2xl font-bold mt-8">What we believe</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Adults-only access must be enforced (strict 18+ age gate + RTA labeling).</li>
        <li>Discovery should feel effortless — search, categories, tags, and related videos.</li>
        <li>Honest attribution and fast DMCA response beat hosting ever will.</li>
      </ul>
      <p className="text-sm text-muted-foreground border border-border rounded-xl p-4 bg-secondary/30">
        Have questions, takedown requests, or partnership inquiries? Visit our{" "}
        <a href="/contact" className="text-primary underline">
          contact page
        </a>{" "}
        or email <strong>{labels.contactEmail}</strong>. View our{" "}
        <a href="/2257" className="text-primary underline">
          2257 Statement
        </a>{" "}
        and{" "}
        <a href="/dmca" className="text-primary underline">
          DMCA Policy
        </a>
        .
      </p>
    </StaticPage>
  );
}

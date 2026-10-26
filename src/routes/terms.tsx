import { useLabels } from "@/hooks/use-labels";
import { StaticPage } from "@/components/site/StaticPage";

export default function TermsPage() {
  const labels = useLabels();
  return (
    <StaticPage title="Terms of Service" titleText="Terms of Service" subtitle="Last updated: January 2026 — Please read carefully. You must be 18+ to use this site.">
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
        <strong>Adults 18+ Only.</strong> This site contains explicit adult content intended solely
        for persons who are at least 18 years of age (or the age of majority in your jurisdiction,
        whichever is greater). By entering {labels.brandName} you confirm that you are an adult,
        that explicit sexual material is legal in your community, and that you voluntarily wish to
        view it.
      </div>

      <h2 className="text-2xl font-bold mt-6">1. Acceptance of Terms</h2>
      <p>
        By accessing, browsing, or using {labels.brandName} (the &quot;Site&quot;) you agree to be
        bound by these Terms of Service and our{" "}
        <a href="/privacy" className="text-primary underline">
          Privacy Policy
        </a>
        . If you do not agree, do not enter or use the Site.
      </p>

      <h2 className="text-2xl font-bold mt-6">2. 18+ Eligibility &amp; User Representations</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>You are at least 18 years old (or the age of majority in your jurisdiction).</li>
        <li>Viewing explicit sexual content is lawful where you are located.</li>
        <li>You will not allow minors to access content via your device or account.</li>
        <li>You will use parental-control tools (e.g. RTA-labeled filtering) to prevent minor access on shared devices.</li>
      </ul>

      <h2 className="text-2xl font-bold mt-6">3. Embedded Content — No Hosting</h2>
      <p>
        {labels.brandName} is an <strong>embed-only</strong> search engine. No video or image files
        are hosted, stored, or uploaded on our servers. All playback is provided by the third-party
        host <strong>Eporner.com</strong> via its official public API and rendered inside an
        <code> &lt;iframe&gt;</code> player. Thumbnails are also loaded directly from Eporner&apos;s
        CDN. We do not control, endorse, or assume responsibility for third-party content, and we
        cannot guarantee the availability, quality, or legality of any embedded stream.
      </p>
      <p>
        All trademarks, videos, and associated metadata remain the property of their respective
        owners. Any AI-generated titles, descriptions, or tags are produced for search indexing only
        and do not create a new copyright in the underlying video.
      </p>

      <h2 className="text-2xl font-bold mt-6">4. Acceptable Use</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Do not attempt to scrape, copy, re-upload, or redistribute embedded streams.</li>
        <li>Do not interfere with, block, or bypass advertisements, age gates, or security measures.</li>
        <li>Do not use the Site to harass, impersonate, or violate any applicable law.</li>
        <li>
          Do not submit or link to content depicting minors, non-consensual activity, or any other
          illegal material — such activity will be reported to law enforcement.
        </li>
      </ul>

      <h2 className="text-2xl font-bold mt-6">5. Intellectual Property &amp; DMCA</h2>
      <p>
        We respect intellectual property rights. If you believe content accessible via an embedded
        player infringes your rights, please follow the procedure described in our{" "}
        <a href="/dmca" className="text-primary underline">
          DMCA Policy
        </a>
        . Upon valid notice we will promptly disable the embed link on our Site. Permanent removal
        of the underlying file must be requested from the host (Eporner).
      </p>

      <h2 className="text-2xl font-bold mt-6">6. 18 U.S.C. § 2257</h2>
      <p>
        {labels.brandName} is not the primary producer of any embedded depiction. § 2257 records
        are maintained by the custodian designated by the original host. See our{" "}
        <a href="/2257" className="text-primary underline">
          2257 Statement
        </a>{" "}
        for details.
      </p>

      <h2 className="text-2xl font-bold mt-6">7. Termination</h2>
      <p>
        We may suspend or terminate your access (including user accounts, saved videos, and comments)
        at any time for conduct that we believe violates these Terms, harms other users, or exposes
        us to liability — without prior notice.
      </p>

      <h2 className="text-2xl font-bold mt-6">8. Disclaimers; No Warranties</h2>
      <p>
        The Site is provided &quot;as is&quot; and &quot;as available&quot; without warranties of
        any kind, express or implied, including fitness for a particular purpose, non-infringement,
        and availability. We do not warrant that the Site will be uninterrupted, secure, or free of
        errors or that embedded third-party content will be accurate or lawful.
      </p>

      <h2 className="text-2xl font-bold mt-6">9. Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, {labels.brandName}, its operators, and affiliates
        shall not be liable for any indirect, incidental, consequential, or punitive damages arising
        from your use of (or inability to use) the Site or any embedded content.
      </p>

      <h2 className="text-2xl font-bold mt-6">10. Contact</h2>
      <p>
        Questions about these Terms?{" "}
        <a href="/contact" className="text-primary underline">
          Contact us
        </a>{" "}
        or email <strong>{labels.contactEmail}</strong>.
      </p>
    </StaticPage>
  );
}

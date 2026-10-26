import { useLabels } from "@/hooks/use-labels";
import { StaticPage } from "@/components/site/StaticPage";

export default function DmcaPage() {
  const labels = useLabels();
  return (
    <StaticPage
      title="DMCA Policy"
      titleText="DMCA Policy"
      subtitle="Copyright takedown requests for embedded content."
    >
      <p>
        {labels.brandName} is an embed-only video search engine. We do not host, store, or upload
        any video files on our servers. All videos displayed on this site are embedded from the
        third-party hosting provider <strong>Eporner.com</strong> via its official public API
        (https://www.eporner.com/api/). The actual video files are hosted solely on Eporner&apos;s
        servers.
      </p>
      <p>
        {labels.brandName} respects intellectual property rights and complies with the Digital
        Millennium Copyright Act (DMCA), 17 U.S.C. § 512. If you are the copyright owner (or
        authorized agent) and believe that content accessible via our embedded player infringes your
        rights, you may submit a takedown notice to us <em>and</em> to the host.
      </p>
      <h2 className="text-2xl font-bold mt-6">What we can remove</h2>
      <p>
        Upon a valid DMCA notice we will promptly remove or disable the embed link / thumbnail
        pointing to the infringing material on {labels.brandName}. Because we do not control the
        host, the underlying file can only be permanently removed by filing a notice directly with
        Eporner:{" "}
        <a
          href="https://www.eporner.com/contact/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          eporner.com/contact
        </a>
        .
      </p>
      <h2 className="text-2xl font-bold mt-6">Required information (17 U.S.C. § 512(c)(3))</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Your full legal name, company affiliation (if any), mailing address, telephone number, and email address.</li>
        <li>Identification of the copyrighted work claimed to have been infringed (or a representative list).</li>
        <li>
          The exact URLs on {labels.brandName} <strong>and</strong> the Eporner source URLs
          (e.g. <code>https://www.eporner.com/video-...</code>) of the allegedly infringing material.
        </li>
        <li>
          A statement that you have a good-faith belief that the use of the material is not
          authorized by the copyright owner, its agent, or the law.
        </li>
        <li>
          A statement, made under penalty of perjury, that the information in your notice is
          accurate and that you are the copyright owner or authorized to act on the owner&apos;s
          behalf.
        </li>
        <li>Your physical or electronic signature.</li>
      </ul>
      <h2 className="text-2xl font-bold mt-6">Submit a notice</h2>
      <p>
        Send notices via our{" "}
        <a href="/contact" className="text-primary underline">
          contact page
        </a>{" "}
        or directly to <strong>{labels.contactEmail}</strong>. For fastest removal, also file a
        notice with Eporner&apos;s DMCA team via their contact page linked above. Incomplete notices
        may not be processed.
      </p>
      <p className="text-sm text-muted-foreground border border-border rounded-xl p-4 bg-secondary/30">
        <strong>Counter-notification:</strong> If you believe your content was removed in error, you
        may submit a counter-notice with the same information plus a statement under penalty of
        perjury that the removal was due to mistake or misidentification. Repeat infringers will
        have their access terminated.
      </p>
    </StaticPage>
  );
}

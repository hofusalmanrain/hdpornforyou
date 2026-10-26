import { useLabels } from "@/hooks/use-labels";
import { StaticPage } from "@/components/site/StaticPage";

export default function Statement2257() {
  const labels = useLabels();
  return (
    <StaticPage title="2257 Statement" titleText="2257 Statement" subtitle="18 U.S.C. § 2257 Record-Keeping Requirements Compliance.">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <strong>18+ Only.</strong> All models, actors, and other persons that appear in any visual
        depiction of actual sexually explicit conduct on this site were 18 years of age or older at
        the time the visual image was created.
      </div>
      <h2 className="text-2xl font-bold mt-6">No production &amp; no hosting</h2>
      <p>
        {labels.brandName} does not produce, direct, photograph, film, or create any of the content
        that is displayed via embedded players. We operate solely as an embed search engine: all
        video streams and thumbnails are loaded directly from the third-party host{" "}
        <strong>Eporner.com</strong> via its official public API. No video files are ever stored,
        hosted, or transmitted from our servers. Category names, titles, descriptions, and tags are
        generated or normalized for search and SEO purposes only.
      </p>
      <h2 className="text-2xl font-bold mt-6">Custodian of records</h2>
      <p>
        Because {labels.brandName} is not the primary producer (as defined in 18 U.S.C. § 2257 and
        28 C.F.R. § 75), we are not the custodian of records required by § 2257 for the embedded
        content. All § 2257 records for the actual depictions are maintained by the custodian(s)
        designated by the <strong>original producer / host</strong> — namely Eporner and/or the
        party that uploaded the content to Eporner. Requests to inspect those records should be
        directed to Eporner&apos;s custodian listed on their official 2257 statement:
        <br />
        <a
          href="https://www.eporner.com/2257/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          https://www.eporner.com/2257/
        </a>
      </p>
      <h2 className="text-2xl font-bold mt-6">Compliance concerns</h2>
      <p>
        If you have reason to believe that content accessible via our embedded player depicts a
        person under 18, or otherwise violates 18 U.S.C. § 2257, please contact us immediately via
        our{" "}
        <a href="/contact" className="text-primary underline">
          contact page
        </a>{" "}
        (or <strong>{labels.contactEmail}</strong>) with the exact page URL and the Eporner source
        URL. We will promptly disable the embed and report the matter to the host. You may also
        report directly to Eporner or to the National Center for Missing &amp; Exploited Children
        (NCMEC) CyberTipline.
      </p>
      <p className="text-sm text-muted-foreground">
        {labels.brandName} will cooperate fully with law enforcement and will terminate access for
        any user who attempts to upload, share, or link to content depicting minors.
      </p>
    </StaticPage>
  );
}

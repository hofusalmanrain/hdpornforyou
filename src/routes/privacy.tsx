import { useLabels } from "@/hooks/use-labels";
import { StaticPage } from "@/components/site/StaticPage";

export default function PrivacyPage() {
  const labels = useLabels();
  return (
    <StaticPage title="Privacy Policy" titleText="Privacy Policy" subtitle="Last updated: January 2026 — How we handle your data on an 18+ embedded streaming site.">
      <p>
        We care about your privacy. This policy explains what we collect, how we use it, and the
        choices you have. By using {labels.brandName} (an 18+ embedded video search engine) you
        consent to the practices described here.
      </p>

      <h2 className="text-2xl font-bold mt-6">1. Information We Collect</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>
          <strong>Account information:</strong> email, full name (optional), password hash, and
          avatar color — only if you create an account to save favorites &amp; sync history.
        </li>
        <li>
          <strong>Usage &amp; device data:</strong> pages viewed, videos viewed, search queries,
          approximate country (derived from an anonymized IP via Cloudflare), browser type, and
          device type — used to operate the service and to serve geo-relevant advertising.
        </li>
        <li>
          <strong>Comments &amp; reactions:</strong> text you voluntarily submit (author name, comment body, likes/dislikes).
        </li>
        <li>
          <strong>Embedded third parties:</strong> video playback and thumbnails are loaded directly
          from <strong>Eporner.com</strong> inside an iframe. Eporner and our ad partners (e.g.
          ExoClick, TrafficStars) may collect IP, user-agent, and cookie data per their own
          policies. We do not control those third parties.
        </li>
      </ul>

      <h2 className="text-2xl font-bold mt-6">2. How We Use It</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>To deliver, secure, and improve {labels.brandName} (authentication, analytics, abuse prevention).</li>
        <li>To personalize content rows, search, and recommendations.</li>
        <li>
          To serve advertising, including interest-based ads. Ad partners use cookies, localStorage,
          and similar technologies to limit frequency, detect fraud, and tailor ads.
        </li>
        <li>To respond to support, DMCA, and 2257 inquiries.</li>
      </ul>
      <p>We do not sell your personal information to third parties.</p>

      <h2 className="text-2xl font-bold mt-6">3. Cookies &amp; Similar Technologies</h2>
      <p>
        We and our partners use cookies, localStorage, and pixel tags for:
      </p>
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Essential:</strong> session authentication (httpOnly, Secure cookies), CSRF protection, age-gate confirmation.</li>
        <li><strong>Functional:</strong> theme preference, saved videos sync, cookie-consent choice.</li>
        <li><strong>Advertising &amp; analytics:</strong> frequency capping, geo-routing of ad networks, performance measurement (see Cookie banner).</li>
      </ul>
      <p>
        You can control cookies via your browser settings and via the cookie banner. Blocking
        essential cookies may prevent sign-in and age verification.
      </p>

      <h2 className="text-2xl font-bold mt-6">4. Data Retention &amp; Security</h2>
      <p>
        Account data is retained while your account is active. You may request deletion at any time.
        Analytics and ad-event logs are aggregated / anonymized and retained for up to 24 months.
        We use HTTPS (via Caddy &amp; Cloudflare), bcrypt password hashing, and httpOnly Secure
        session cookies to protect data.
      </p>

      <h2 className="text-2xl font-bold mt-6">5. Your Rights</h2>
      <p>
        Depending on your jurisdiction (GDPR / CCPA etc.) you may request access, correction,
        deletion, or export of your personal data, and you may object to or restrict certain
        processing. To exercise these rights, contact us via our{" "}
        <a href="/contact" className="text-primary underline">
          contact page
        </a>{" "}
        or email <strong>{labels.contactEmail}</strong>. We will respond within 30 days.
      </p>

      <h2 className="text-2xl font-bold mt-6">6. International Transfers</h2>
      <p>
        Our servers may be located outside your country of residence. By using the Site you consent
        to the transfer and processing of your data in that jurisdiction.
      </p>

      <h2 className="text-2xl font-bold mt-6">7. Changes</h2>
      <p>
        We may update this policy from time to time. The &quot;Last updated&quot; date at the top
        will reflect the latest version. Continued use after changes constitutes acceptance.
      </p>
    </StaticPage>
  );
}

import { StaticPage } from "@/components/site/StaticPage";
import { useState } from "react";
import { toast } from "sonner";
import { useLabels } from "@/hooks/use-labels";

export default function ContactPage() {
  const labels = useLabels();
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const to = labels.contactEmail || "demo@gmail.com";
    const subject = encodeURIComponent(`Contact from ${name || "website visitor"}`);
    const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`);
    // Open the user's mail client addressed to the configured inbox.
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    setSent(true);
    toast.success(`Opening your mail app to send a message to ${to}.`);
  };

  return (
    <StaticPage
      title={
        <>
          Get in <span className="text-gradient">touch</span>
        </>
      }
      titleText="Get in touch"
      subtitle={`We usually reply within 1–2 business days. Messages go to ${labels.contactEmail}. For DMCA or 2257 notices, please include the exact page URL and the Eporner source URL for fastest processing.`}
    >
      <form onSubmit={onSubmit} className="grid gap-4 mt-6">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="bg-secondary/60 border border-border rounded-xl px-4 py-3 outline-none focus:border-primary"
        />
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="bg-secondary/60 border border-border rounded-xl px-4 py-3 outline-none focus:border-primary"
        />
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="How can we help? For takedowns, include both the page URL on this site and the Eporner source URL."
          rows={6}
          className="bg-secondary/60 border border-border rounded-xl px-4 py-3 outline-none focus:border-primary resize-none"
        />
        <button className="rounded-full gradient-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow w-fit">
          {sent ? "Message prepared ✓" : "Send message"}
        </button>
        <p className="text-xs text-muted-foreground">
          By contacting us you confirm you are 18+ and agree to our{" "}
          <a href="/terms" className="text-primary underline">
            Terms
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-primary underline">
            Privacy Policy
          </a>
          . Abuse or content depicting minors will be reported to law enforcement.
        </p>
      </form>
    </StaticPage>
  );
}

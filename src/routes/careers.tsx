import { StaticPage } from "@/components/site/StaticPage";
import { useLabels } from "@/hooks/use-labels";

export default function CareersPage() {
  const labels = useLabels();
  const to = labels.contactEmail || "demo@gmail.com";
  const roles = [
    { title: "Senior Frontend Engineer", location: "Remote", type: "Full-time" },
    { title: "Product Designer", location: "Remote", type: "Full-time" },
    { title: "Content Operations Lead", location: "Remote", type: "Full-time" },
  ];
  const applyHref = (title: string) =>
    `mailto:${to}?subject=${encodeURIComponent(`Application — ${title}`)}&body=${encodeURIComponent(
      `Hi,\n\nI'd like to apply for the ${title} role.\n\nName:\nLinkedIn / portfolio:\nAbout me:\n`,
    )}`;

  return (
    <StaticPage
      title={
        <>
          Build the future of <span className="text-gradient">video</span>
        </>
      }
      titleText="Build the future of video"
      subtitle={`We're a small, fully-remote team shipping an 18+ embedded video platform. Applications go to ${to}. You must be 18+ to apply.`}
    >
      <p>
        We hire for curiosity, craft and ownership. If you love performance, polished UI and product
        thinking, we want to talk.
      </p>
      <div className="grid gap-4 mt-6">
        {roles.map((r) => (
          <div
            key={r.title}
            className="rounded-2xl border border-border bg-card/50 p-5 hover:border-primary/60 transition-colors"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-lg">{r.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {r.location} · {r.type}
                </p>
              </div>
              <a
                href={applyHref(r.title)}
                className="rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                Apply
              </a>
            </div>
          </div>
        ))}
      </div>
    </StaticPage>
  );
}

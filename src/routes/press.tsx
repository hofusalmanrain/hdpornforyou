import { StaticPage } from "@/components/site/StaticPage";

export default function PressPage() {
  return (
    <StaticPage
      title={
        <>
          Press & <span className="text-gradient">media</span>
        </>
      }
      titleText="Press & media"
      subtitle="Brand assets, story highlights and contact details for this 18+ embedded streaming platform."
    >
      <p>
        For press inquiries, reach out via our{" "}
        <a href="/contact" className="text-primary underline">
          contact page
        </a>
        .
      </p>
      <h2 className="text-2xl font-bold mt-8">Brand assets</h2>
      <p>
        Download our logo, color palette and typography guidelines. Please respect our brand
        guidelines when using these assets.
      </p>
      <h2 className="text-2xl font-bold mt-8">In the news</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>"A refreshing take on video discovery" — TechBeat</li>
        <li>"Beautifully designed and lightning fast" — UI Weekly</li>
        <li>"One to watch" — Creator Daily</li>
      </ul>
    </StaticPage>
  );
}

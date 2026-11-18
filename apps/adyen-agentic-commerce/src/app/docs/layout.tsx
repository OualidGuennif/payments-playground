// Spec: knowledge/components/adyen-agentic-commerce.md
import { DocsNav } from "@/components/docs/DocsNav";
import { DOCS } from "@/components/docs/content";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <DocsNav
        items={[
          ["/docs", "Overview"],
          ...DOCS.map((d): [string, string] => [`/docs/${d.slug}`, d.title]),
        ]}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

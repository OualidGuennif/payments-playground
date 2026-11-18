// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCS, docBySlug } from "@/components/docs/content";
import { PluginDownload } from "@/components/docs/PluginDownload";
import { Rich } from "@/components/docs/Rich";
import { SequenceDiagram } from "@/components/docs/SequenceDiagram";
import { TryIt } from "@/components/docs/TryIt";
import { WebMcpCheck } from "@/components/docs/WebMcpCheck";

type Params = Promise<{ topic: string }>;

export const dynamicParams = false;
export const generateStaticParams = () => DOCS.map((d) => ({ topic: d.slug }));

export async function generateMetadata({ params }: { params: Params }) {
  const doc = docBySlug((await params).topic);
  return { title: doc ? `${doc.title} · Docs` : "Docs" };
}

export default async function DocPage({ params }: { params: Params }) {
  const doc = docBySlug((await params).topic);
  if (!doc) notFound();
  const at = DOCS.indexOf(doc);
  const before = DOCS[at - 1];
  const after = DOCS[at + 1];
  return (
    <article className="space-y-8">
      <header className="max-w-[68ch] space-y-2">
        <p className="eyebrow">Docs</p>
        <h1 className="text-3xl">{doc.title}</h1>
        <p className="text-muted">
          <Rich text={doc.intro} />
        </p>
      </header>

      <SequenceDiagram title={`${doc.title}: ${doc.short}`} actors={doc.actors} steps={doc.steps} />

      {doc.notes.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {doc.notes.map((note) => (
            <section key={note.title} id={note.id} className="panel scroll-mt-24 space-y-2">
              <h2 className="text-lg">{note.title}</h2>
              {note.body.map((p) => (
                <p key={p.slice(0, 40)} className="text-sm text-muted">
                  <Rich text={p} />
                </p>
              ))}
            </section>
          ))}
        </div>
      ) : null}

      {doc.slug === "webmcp" ? <WebMcpCheck /> : null}
      {doc.slug === "chatgpt" ? <PluginDownload /> : null}
      {doc.tries.length ? <TryIt requests={doc.tries} /> : null}

      <section className="panel flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">See these messages as they happen on this store.</p>
        <div className="flex flex-wrap gap-2">
          {doc.channels.map((channel) => (
            <a
              key={channel}
              href={`/back-office?tab=log&channel=${channel}`}
              className="btn-ghost px-4"
            >
              Log: {channel}
            </a>
          ))}
        </div>
      </section>

      <nav aria-label="More docs" className="grid gap-3 sm:grid-cols-2">
        {before ? (
          <Link href={`/docs/${before.slug}`} className="panel block hover:border-ink">
            <span className="block text-xs text-muted">Previous</span>
            <span className="block font-medium">{before.title}</span>
          </Link>
        ) : (
          <Link href="/docs" className="panel block hover:border-ink">
            <span className="block text-xs text-muted">Back to</span>
            <span className="block font-medium">The whole purchase</span>
          </Link>
        )}
        {after ? (
          <Link href={`/docs/${after.slug}`} className="panel block text-right hover:border-ink">
            <span className="block text-xs text-muted">Next</span>
            <span className="block font-medium">{after.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}

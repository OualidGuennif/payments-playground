// Spec: knowledge/components/adyen-agentic-commerce.md
import type { TraceEntry } from "@/server/trace";
import { CopyButton } from "./CopyButton";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const two = (n: number) => String(n).padStart(2, "0");

// In UTC and built by hand, like the account page: the server's text never depends on its locale.
export function stamp(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
}

export const statusTone = (status: number) =>
  status >= 500
    ? "text-bad"
    : status >= 400
      ? "text-warn"
      : status >= 300
        ? "text-muted"
        : "text-ok";

// One line per exchange; the redacted detail opens under it, with a link to everything that
// names the same reference.
export function LogList({
  entries,
  refHref,
  empty = "Nothing logged yet.",
}: {
  entries: TraceEntry[];
  refHref: (ref: string) => string;
  empty?: string;
}) {
  if (!entries.length) return <p className="panel text-sm text-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card text-sm">
      {entries.map((t) => {
        const json = JSON.stringify(t.detail, null, 2);
        return (
          <li key={t.id}>
            <details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-line/30 md:grid-cols-[7.5rem_5.5rem_1fr_3rem_9rem] [&::-webkit-details-marker]:hidden">
                <span className="text-xs text-muted tabular-nums md:order-none">{stamp(t.at)}</span>
                <span className="justify-self-start md:order-none">
                  <span className="pill border-line text-muted">{t.channel}</span>
                </span>
                <span
                  className={`text-right font-medium tabular-nums md:order-4 md:text-left ${statusTone(t.status)}`}
                >
                  {t.status}
                </span>
                <span className="col-span-3 min-w-0 break-all font-mono text-xs md:order-3 md:col-span-1">
                  {t.method} {t.path}
                </span>
                <span className="col-span-3 truncate text-xs text-muted md:order-5 md:col-span-1">
                  {t.actor}
                </span>
              </summary>
              <div className="space-y-2 border-t border-line bg-paper/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  {t.ref ? (
                    <a href={refHref(t.ref)} className="font-mono underline">
                      Everything about {t.ref}
                    </a>
                  ) : (
                    <span className="text-muted">No reference</span>
                  )}
                  <CopyButton text={json} />
                </div>
                <pre className="max-h-96 overflow-auto rounded-xl bg-card p-3 text-xs">{json}</pre>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

// Spec: knowledge/components/adyen-agentic-commerce.md

// 1 … 9 10 11 … 20: the first and last pages, and a window of up to five around the current one.
export function pageItems(page: number, pages: number): (number | "gap")[] {
  const range = (from: number, to: number) =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  if (pages <= 7) return range(1, pages);
  const start = Math.max(2, Math.min(page - 1, pages - 4));
  const end = Math.min(pages - 1, Math.max(page + 1, 5));
  return [
    1,
    ...(start > 2 ? (["gap"] as const) : []),
    ...range(start, end),
    ...(end < pages - 1 ? (["gap"] as const) : []),
    pages,
  ];
}

const LINK =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm tabular-nums";

export function Pager({
  page,
  pages,
  total,
  per,
  href,
  noun = "entries",
}: {
  page: number;
  pages: number;
  total: number;
  per: number;
  href: (page: number) => string;
  noun?: string;
}) {
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(page * per, total);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted tabular-nums">
        {from}–{to} of {total} {noun}
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-1.5">
          {page > 1 ? (
            <a href={href(page - 1)} className={`${LINK} border-line bg-card hover:border-ink`}>
              Previous
            </a>
          ) : null}
          <span className="px-2 text-muted tabular-nums sm:hidden">
            {page} / {pages}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            {pageItems(page, pages).map((item, i) =>
              item === "gap" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity but its place.
                <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted">
                  …
                </span>
              ) : (
                <a
                  key={item}
                  href={href(item)}
                  aria-current={item === page ? "page" : undefined}
                  aria-label={`Page ${item}`}
                  className={`${LINK} ${
                    item === page
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-card hover:border-ink"
                  }`}
                >
                  {item}
                </a>
              ),
            )}
          </span>
          {page < pages ? (
            <a href={href(page + 1)} className={`${LINK} border-line bg-card hover:border-ink`}>
              Next
            </a>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

import type { Heading } from "@/server/content/markdown";

const linkClass =
  "inline-flex min-h-9 items-center rounded-input px-2 py-1 text-base text-ink underline-offset-4 hover:underline";

/**
 * "On this page" for long policies: a sticky list from large screens, a disclosure below that. Two
 * landmarks with different names, only one of which is ever displayed.
 */
export function PolicyToc({ headings }: { headings: readonly Heading[] }) {
  const items = headings.filter((h) => h.depth === 2);
  if (items.length < 4) return null;
  const list = (
    <ol className="flex flex-col">
      {items.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`} className={linkClass}>
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <nav aria-label="Contents" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <p className="mb-2 px-2 text-sm font-bold tracking-widest text-ink-muted uppercase">On this page</p>
        {list}
      </nav>
      <nav aria-label="On this page" className="lg:hidden">
        <details className="rounded-card border-token bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold text-ink">
            On this page
          </summary>
          <div className="px-2 pb-3">{list}</div>
        </details>
      </nav>
    </>
  );
}

import { renderProductMarkdown } from "./markdown";

/** Product description from the admin's Markdown. Raw HTML in it is escaped (see `markdown.ts`). */
export function Description({ markdown }: { markdown: string | null }) {
  if (!markdown?.trim()) return null;
  return (
    <section aria-labelledby="about-heading">
      <h2 id="about-heading" className="font-display text-xl display-fx">
        About this product
      </h2>
      <div
        data-testid="description"
        className={
          "mt-2 flex flex-col gap-3 text-base leading-relaxed text-ink " +
          "[&_a]:font-semibold [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:no-underline " +
          "[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:font-bold " +
          "[&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-input " +
          "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1 " +
          "[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-ink-muted " +
          "[&_code]:rounded-input [&_code]:bg-surface-2 [&_code]:px-1"
        }
        dangerouslySetInnerHTML={{ __html: renderProductMarkdown(markdown) }}
      />
    </section>
  );
}

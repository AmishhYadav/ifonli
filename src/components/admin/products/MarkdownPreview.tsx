"use client";

import * as React from "react";

import { renderProductMarkdown } from "@/components/store/pdp/markdown";

/**
 * Live preview of a product description. It renders with the SAME sanitising renderer as the
 * storefront (`renderProductMarkdown`: raw HTML escaped, link and image URLs limited to http(s),
 * mailto, tel and site-relative paths), because another staff member may open a description someone
 * else typed and click its links here; the preview must not be a way to run script in the admin.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const html = React.useMemo(() => renderProductMarkdown(source), [source]);
  if (!source.trim()) {
    return <p className="text-[13px] text-admin-ink-faint">Nothing to preview yet.</p>;
  }
  return (
    <div
      className="text-sm leading-relaxed text-admin-ink [&_a]:text-admin-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-admin-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-admin-ink-muted [&_code]:rounded [&_code]:bg-admin-surface-2 [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h2]:mb-2 [&_h2]:text-base [&_h3]:mb-1.5 [&_h3]:text-sm [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

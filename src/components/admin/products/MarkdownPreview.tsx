"use client";

import { marked } from "marked";
import * as React from "react";

// Raw HTML typed into the description is shown as text, never injected.
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
marked.use({ renderer: { html: ({ text }) => escapeHtml(text) } });

export function MarkdownPreview({ source }: { source: string }) {
  const html = React.useMemo(
    () => marked.parse(source, { async: false, gfm: true, breaks: false }),
    [source],
  );
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

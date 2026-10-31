import { cn } from "@/lib/cn";

import "./policy.css";

/**
 * Rendered Markdown (policy or FAQ answer). `html` comes from `renderMarkdown` (raw HTML escaped, URLs
 * filtered), never from user input directly.
 */
export function PolicyProse({
  html,
  compact,
  className,
}: {
  html: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("policy-prose", compact && "policy-prose-compact", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

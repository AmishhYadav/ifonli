import { renderMarkdown, type Heading } from "./markdown";
import { renderTemplate, type TemplateContext, type TemplateProblem } from "./render-template";

/**
 * Publishing rule (content/README.md, plan section 14): in production a policy or FAQ answer is shown only
 * when it is published and every token resolved to a real, non-placeholder value. In review mode
 * (development, or a build made with NEXT_PUBLIC_ENABLE_DEV_PAGES=1) the owner sees it anyway, with
 * markers on the problem spots and a draft banner.
 */

export function isReviewMode(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
}

export type WithheldReason = "unpublished" | "unresolved";

export interface PreparedContent {
  /** Empty when the content is withheld. */
  html: string;
  headings: Heading[];
  problems: TemplateProblem[];
  /** Not final: unpublished or has problems. Only ever visible in review mode. */
  draft: boolean;
  withheld: WithheldReason | null;
}

export function prepareContent(input: {
  bodyMd: string;
  published: boolean;
  ctx: TemplateContext;
  review: boolean;
  /** Policies show their title separately, so the body's leading `# H1` is dropped. */
  dropTitle?: boolean;
}): PreparedContent {
  const { text, problems } = renderTemplate(input.bodyMd, input.ctx, { preview: input.review });
  const draft = !input.published || problems.length > 0;
  if (!input.review && draft) {
    return {
      html: "",
      headings: [],
      problems,
      draft,
      withheld: input.published ? "unresolved" : "unpublished",
    };
  }
  const { html, headings } = renderMarkdown(text, { dropTitle: input.dropTitle });
  return { html, headings, problems, draft, withheld: null };
}

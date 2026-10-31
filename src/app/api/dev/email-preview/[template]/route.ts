import { isVibe, VIBES } from "@/features/vibe/config";
import { FIXTURE_PAYLOADS, fixtureContext } from "../../../../../../emails/fixtures";
import { isTemplateName, renderTemplate, TEMPLATE_NAMES } from "@/server/notify/templates";

/**
 * DEV ONLY (404 in production unless NEXT_PUBLIC_ENABLE_DEV_PAGES=1). Renders an e-mail template with
 * its fixture data so the owner can review it in a browser.
 *
 *   /api/dev/email-preview/index                      list of templates
 *   /api/dev/email-preview/order_confirmed            HTML
 *   /api/dev/email-preview/order_confirmed?vibe=gothic  palette of that vibe (default: neutral base)
 *   /api/dev/email-preview/order_confirmed?format=text  plain-text alternative
 */
const enabled = () => process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
const notFound = () => new Response("Not found", { status: 404 });
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request, ctx: { params: Promise<{ template: string }> }): Promise<Response> {
  if (!enabled()) return notFound();
  const { template } = await ctx.params;
  const url = new URL(req.url);

  if (template === "index") {
    const items = TEMPLATE_NAMES.map((t) => {
      const links = [`<a href="/api/dev/email-preview/${t}">${t}</a>`, `<a href="/api/dev/email-preview/${t}?format=text">text</a>`];
      for (const v of VIBES) links.push(`<a href="/api/dev/email-preview/${t}?vibe=${v}">${v}</a>`);
      return `<li>${links.join(" &middot; ")}</li>`;
    }).join("");
    return new Response(`<!doctype html><meta charset="utf-8"><title>E-mail previews</title><body style="font-family:sans-serif"><h1>E-mail previews</h1><ul>${items}</ul>`, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
    });
  }

  if (!isTemplateName(template)) return notFound();
  const vibeParam = url.searchParams.get("vibe");
  const rendered = await renderTemplate(template, FIXTURE_PAYLOADS[template], fixtureContext(isVibe(vibeParam) ? vibeParam : null));
  if (url.searchParams.get("format") === "text") {
    return new Response(`Subject: ${rendered.subject}\n\n${rendered.text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
  return new Response(rendered.html, { headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

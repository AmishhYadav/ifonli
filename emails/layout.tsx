import { Body, Head, Html, Link, Preview } from "react-email";
import type { CSSProperties, ReactNode } from "react";

import { paletteFor, type EmailPalette } from "./theme";
import type { EmailContext } from "./types";

export const FONT_STACK = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

interface LayoutProps {
  ctx: EmailContext;
  /** Inbox preview line (hidden in the body). */
  preview: string;
  heading: string;
  children: ReactNode;
}

/**
 * Shared shell: wordmark header, themed card, store footer. Table layout with inline styles only so
 * Gmail and Outlook render it the same; 600px max, fluid below that (readable at 320px). No images,
 * no tracking pixels. Copy stays neutral: the vibe only changes colours.
 */
export function Layout({ ctx, preview, heading, children }: LayoutProps) {
  const c = paletteFor(ctx.vibe);
  const { store } = ctx;
  const cell = (extra: CSSProperties = {}): CSSProperties => ({ fontFamily: FONT_STACK, ...extra });

  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: c.bg, fontFamily: FONT_STACK }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} bgcolor={c.bg} style={{ backgroundColor: c.bg }}>
          <tbody>
            <tr>
              <td align="center" style={cell({ padding: "24px 12px" })}>
                <table role="presentation" width="600" cellPadding={0} cellSpacing={0} border={0} style={{ width: "100%", maxWidth: 600 }}>
                  <tbody>
                    <tr>
                      <td style={cell({ padding: "0 4px 14px", fontSize: 20, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: c.accent })}>
                        {store.brandName}
                      </td>
                    </tr>
                    <tr>
                      <td data-skip-in-text="true" height={6} style={{ height: 6, lineHeight: "6px", fontSize: 0, backgroundColor: c.accent }}>
                        &nbsp;
                      </td>
                    </tr>
                    <tr>
                      <td data-skip-in-text="true" height={3} style={{ height: 3, lineHeight: "3px", fontSize: 0, backgroundColor: c.highlight }}>
                        &nbsp;
                      </td>
                    </tr>
                    <tr>
                      <td style={cell({ backgroundColor: c.surface, padding: "28px 24px 24px", color: c.ink, fontSize: 16, lineHeight: "24px" })}>
                        <h1 style={{ margin: "0 0 16px", fontFamily: FONT_STACK, fontSize: 24, lineHeight: "30px", fontWeight: 800, color: c.ink }}>{heading}</h1>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={cell({ padding: "20px 4px 0", fontSize: 12, lineHeight: "18px", color: c.muted })}>
                        <Footer ctx={ctx} c={c} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

function Footer({ ctx, c }: { ctx: EmailContext; c: EmailPalette }) {
  const { store } = ctx;
  const link: CSSProperties = { color: c.link, textDecoration: "underline" };
  return (
    <>
      <p style={{ margin: "0 0 8px" }}>
        Questions? Write to{" "}
        <Link href={`mailto:${store.supportEmail}`} style={link}>
          {store.supportEmail}
        </Link>
        {store.supportPhone ? ` or call ${store.supportPhone}` : ""}. {store.supportHours}
      </p>
      <p style={{ margin: "0 0 8px" }}>
        {store.legalName}, {store.address}
      </p>
      <p style={{ margin: 0 }}>
        Grievance officer: {store.grievance.name}, {store.grievance.designation} (
        <Link href={`mailto:${store.grievance.email}`} style={link}>
          {store.grievance.email}
        </Link>
        , {store.grievance.phone})
      </p>
    </>
  );
}

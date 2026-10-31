import { Layout, FONT_STACK } from "../layout";
import { P } from "../parts";
import type { TemplateProps } from "../payloads";
import { paletteFor } from "../theme";

const PURPOSE = {
  "sign-in": "sign in",
  "email-verification": "verify your email",
  "forget-password": "reset your password",
  "change-email": "change your email",
} as const;

export function LoginOtp({ payload, ctx }: TemplateProps<"login_otp">) {
  const c = paletteFor(ctx.vibe);
  return (
    <Layout ctx={ctx} preview={`Your code is ${payload.otp}`} heading="Your one-time code">
      <P ctx={ctx}>Use this code to {PURPOSE[payload.type]}. It works for {payload.expiresMinutes} minutes.</P>
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ margin: "4px 0 20px" }}>
        <tbody>
          <tr>
            <td style={{ backgroundColor: c.surfaceAlt, padding: "14px 24px", fontFamily: FONT_STACK, fontSize: 32, lineHeight: "36px", fontWeight: 800, letterSpacing: "0.3em", color: c.ink }}>
              {payload.otp}
            </td>
          </tr>
        </tbody>
      </table>
      <P ctx={ctx} muted>
        Never share this code with anyone. We will never ask for it. If you did not ask for it, you can ignore this email.
      </P>
    </Layout>
  );
}

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** WCAG 2.2 AA: every level A and AA rule set up to 2.2. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe with the WCAG 2.2 AA tags and returns one readable line per violation (any impact, minor
 * included). An empty array means the page is clean. Pass `exclude` for third-party widgets only.
 */
export async function axeViolations(
  page: Page,
  options: { exclude?: string[]; include?: string } = {},
): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (options.include) builder = builder.include(options.include);
  // The Next.js dev overlay is not part of the product.
  builder = builder.exclude("nextjs-portal");
  // A11Y_EXCLUDE="sel1|sel2" skips known third-party or in-flight nodes for one run; nothing is excluded by default.
  const fromEnv = (process.env.A11Y_EXCLUDE ?? "").split("|").filter(Boolean);
  for (const selector of [...(options.exclude ?? []), ...fromEnv])
    builder = builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations.map(
    (v) =>
      `${v.id} [${v.impact}] ${v.help}: ${v.nodes
        .slice(0, 4)
        .map(
          (n) =>
            `${n.target.join(" ")}${n.any[0]?.message ? ` (${n.any[0].message.slice(0, 120)})` : ""}`,
        )
        .join(" | ")}`,
  );
}

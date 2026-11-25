/** Pure helpers for the security e-mails (`security-alerts.ts`). No database, so they are unit-testable. */

/** Longest browser user agent kept in a sign-in alert (and its outbox payload). */
export const USER_AGENT_MAX = 200;

/** A user agent for the e-mail: control characters and line breaks removed, runs of spaces collapsed, at most 200 characters; null when empty. */
export function truncateUserAgent(userAgent: string | null | undefined): string | null {
  const cleaned = (userAgent ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned.slice(0, USER_AGENT_MAX);
}

/** Merges recipient lists: lower-cased, de-duplicated, blanks dropped, first-seen order kept (so nobody gets the same alert twice). */
export function mergeRecipients(...lists: ReadonlyArray<readonly (string | null | undefined)[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const email = raw?.trim().toLowerCase();
      if (email && !seen.has(email)) {
        seen.add(email);
        out.push(email);
      }
    }
  }
  return out;
}

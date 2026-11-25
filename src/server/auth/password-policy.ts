/**
 * Local (offline) deny-list for admin passwords a person chose themselves. It catches the obvious
 * guesses that pass a length check and that the breach list may not know yet (the shop's own name,
 * "admin", the e-mail address). It does not replace the breach check (`password-breach.ts`) or the
 * 12-character minimum (`MIN_ADMIN_PASSWORD_LENGTH`); it is one pure function so every path that
 * accepts a human-chosen password (enrolment, staff creation, `scripts/create-admin.ts`) applies the
 * same rule. Passwords our own code generates are random and skip it.
 */

export type AdminPasswordProblem = "blocked_word" | "same_as_email" | "repeated_character";

/** Words no admin password may contain, compared lower-cased. */
export const BLOCKED_PASSWORD_WORDS = ["ifonli", "password", "admin"] as const;

/**
 * What is wrong with `password`, or null when it passes. `email` is the account's address; a password
 * equal to its local part (the text before the `@`, compared lower-cased) is refused.
 */
export function adminPasswordProblem(password: string, email?: string | null): AdminPasswordProblem | null {
  const lower = password.toLowerCase();
  if (BLOCKED_PASSWORD_WORDS.some((word) => lower.includes(word))) return "blocked_word";
  const localPart = email?.trim().toLowerCase().split("@")[0] ?? "";
  if (localPart.length > 0 && lower === localPart) return "same_as_email";
  // Code points, not UTF-16 units, so a repeated emoji counts as one character too.
  const chars = Array.from(password);
  if (chars.length > 0 && chars.every((c) => c === chars[0])) return "repeated_character";
  return null;
}

/** Sentence for the person who typed the password (shown in the enrolment form and returned to the owner). */
export function describeAdminPasswordProblem(problem: AdminPasswordProblem): string {
  switch (problem) {
    case "blocked_word":
      return 'That password is too easy to guess: it must not contain "ifonli", "password" or "admin". Choose another.';
    case "same_as_email":
      return "That password is too easy to guess: it must not be the first part of your email address. Choose another.";
    case "repeated_character":
      return "That password is too easy to guess: it is one character repeated. Choose another.";
  }
}

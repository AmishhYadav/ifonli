import { describe, expect, it } from "vitest";

import {
  BLOCKED_PASSWORD_WORDS,
  adminPasswordProblem,
  describeAdminPasswordProblem,
} from "@/server/auth/password-policy";

const email = "meera.shah@example.com";

describe("adminPasswordProblem", () => {
  it("accepts a long, unrelated passphrase", () => {
    expect(adminPasswordProblem("correct horse battery staple", email)).toBeNull();
    expect(adminPasswordProblem("Tr0ub4dor&3-and-more", email)).toBeNull();
  });

  it.each(["ifonli", "password", "admin"])("refuses a password containing %s in any letter case", (word) => {
    for (const pw of [`${word}-and-more-text`, `lots-of-${word.toUpperCase()}-here`, `x${word[0]!.toUpperCase()}${word.slice(1)}y-1234`]) {
      expect(adminPasswordProblem(pw, email), pw).toBe("blocked_word");
    }
  });

  it("knows exactly the three words", () => {
    expect([...BLOCKED_PASSWORD_WORDS]).toEqual(["ifonli", "password", "admin"]);
  });

  it("refuses the first part of the account's own e-mail address, case-insensitively", () => {
    expect(adminPasswordProblem("meera.shah", email)).toBe("same_as_email");
    expect(adminPasswordProblem("Meera.Shah", email)).toBe("same_as_email");
    expect(adminPasswordProblem("Meera.Shah", "  MEERA.SHAH@Example.com ")).toBe("same_as_email");
    // Only an exact match counts, and only for that account.
    expect(adminPasswordProblem("meera.shah-2026-x", email)).toBeNull();
    expect(adminPasswordProblem("meera.shah", "someone.else@example.com")).toBeNull();
  });

  it("does not compare against anything when no e-mail is known", () => {
    expect(adminPasswordProblem("meera.shah", null)).toBeNull();
    expect(adminPasswordProblem("meera.shah", undefined)).toBeNull();
    expect(adminPasswordProblem("meera.shah", "@example.com")).toBeNull();
  });

  it("refuses one character repeated, not a mix", () => {
    expect(adminPasswordProblem("aaaaaaaaaaaa", email)).toBe("repeated_character");
    expect(adminPasswordProblem("111111111111", email)).toBe("repeated_character");
    expect(adminPasswordProblem("😀😀😀😀😀😀😀😀😀😀😀😀", email)).toBe("repeated_character");
    expect(adminPasswordProblem("aaaaaaaaaaab", email)).toBeNull();
    expect(adminPasswordProblem("abababababab", email)).toBeNull();
  });

  it("is not tripped by an empty string (length rules live elsewhere)", () => {
    expect(adminPasswordProblem("", email)).toBeNull();
  });

  it("has a sentence for every problem, none of which echoes the password", () => {
    for (const problem of ["blocked_word", "same_as_email", "repeated_character"] as const) {
      const text = describeAdminPasswordProblem(problem);
      expect(text).toMatch(/too easy to guess/);
      expect(text).toMatch(/Choose another\.$/);
    }
  });
});

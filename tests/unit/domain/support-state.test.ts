import { describe, expect, it } from "vitest";

import {
  CASE_TRANSITIONS,
  CONTACT_STATUSES,
  CONTACT_TRANSITIONS,
  SUPPORT_STATUSES,
  canMoveCase,
  canMoveContact,
  isActiveCase,
  statusForResolution,
} from "@/server/domain/support-state";

describe("contact message transitions", () => {
  it("allows new -> open/closed, open -> closed and closed -> open", () => {
    expect(canMoveContact("new", "open")).toBe(true);
    expect(canMoveContact("new", "closed")).toBe(true);
    expect(canMoveContact("open", "closed")).toBe(true);
    expect(canMoveContact("closed", "open")).toBe(true);
  });

  it("never goes back to new and never stays in place", () => {
    for (const from of CONTACT_STATUSES) {
      expect(canMoveContact(from, "new")).toBe(false);
      expect(canMoveContact(from, from)).toBe(false);
    }
    expect(canMoveContact("open", "new")).toBe(false);
  });

  it("only names known statuses", () => {
    for (const targets of Object.values(CONTACT_TRANSITIONS)) {
      for (const t of targets) expect(CONTACT_STATUSES).toContain(t);
    }
  });
});

describe("support case transitions", () => {
  it("open -> in_progress -> resolved/rejected, and open can be decided directly", () => {
    expect(canMoveCase("open", "in_progress")).toBe(true);
    expect(canMoveCase("in_progress", "resolved")).toBe(true);
    expect(canMoveCase("in_progress", "rejected")).toBe(true);
    expect(canMoveCase("open", "resolved")).toBe(true);
    expect(canMoveCase("open", "rejected")).toBe(true);
  });

  it("resolved and rejected are terminal; nothing re-opens or loops", () => {
    for (const to of SUPPORT_STATUSES) {
      expect(canMoveCase("resolved", to)).toBe(false);
      expect(canMoveCase("rejected", to)).toBe(false);
      expect(canMoveCase(to, to)).toBe(false);
    }
    expect(canMoveCase("in_progress", "open")).toBe(false);
  });

  it("only names known statuses", () => {
    for (const targets of Object.values(CASE_TRANSITIONS)) {
      for (const t of targets) expect(SUPPORT_STATUSES).toContain(t);
    }
  });

  it("knows which cases are still active and which status a resolution ends in", () => {
    expect(isActiveCase("open")).toBe(true);
    expect(isActiveCase("in_progress")).toBe(true);
    expect(isActiveCase("resolved")).toBe(false);
    expect(isActiveCase("rejected")).toBe(false);
    expect(statusForResolution("refund")).toBe("resolved");
    expect(statusForResolution("replacement")).toBe("resolved");
    expect(statusForResolution("rejected")).toBe("rejected");
  });
});

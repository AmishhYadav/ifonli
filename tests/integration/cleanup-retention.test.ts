import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { notificationOutbox, session, user, verification } from "@/server/db/schema";
import { cleanupHousekeeping } from "@/server/payments/cleanup";

const db = () => getDb();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("cleanup: personal-data retention", () => {
  it("deletes delivered e-mails after 90 days, and expired sessions and verification rows", async () => {
    await db().insert(notificationOutbox).values([
      { channel: "email", template: "order_confirmation", to: "a@example.com", status: "sent", sentAt: daysAgo(91) },
      { channel: "email", template: "order_confirmation", to: "b@example.com", status: "sent", sentAt: daysAgo(10) },
      // Not delivered: kept until it is (or is dealt with by hand), whatever its age.
      { channel: "email", template: "order_confirmation", to: "c@example.com", status: "failed" },
      { channel: "email", template: "order_confirmation", to: "d@example.com", status: "pending" },
    ]);
    await db().insert(user).values({ id: "u1", name: "U", email: "u@example.com" });
    await db().insert(session).values([
      { id: "s-old", userId: "u1", token: "t-old", expiresAt: daysAgo(1) },
      { id: "s-live", userId: "u1", token: "t-live", expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    await db().insert(verification).values([
      { id: "v-old", identifier: "sign-in-otp-u@example.com", value: "1:0", expiresAt: daysAgo(1) },
      { id: "v-live", identifier: "sign-in-otp-v@example.com", value: "1:0", expiresAt: new Date(Date.now() + 600_000) },
    ]);

    expect(await cleanupHousekeeping(db())).toMatchObject({
      sentNotificationsDeleted: 1,
      expiredSessionsDeleted: 1,
      expiredVerificationsDeleted: 1,
    });
    expect((await db().select().from(notificationOutbox)).map((n) => n.to).sort()).toEqual([
      "b@example.com",
      "c@example.com",
      "d@example.com",
    ]);
    expect((await db().select().from(session)).map((s) => s.id)).toEqual(["s-live"]);
    expect((await db().select().from(verification)).map((v) => v.id)).toEqual(["v-live"]);
  });
});

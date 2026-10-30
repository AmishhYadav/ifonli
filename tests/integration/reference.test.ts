import path from "node:path";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { pincodes, states } from "@/server/db/schema";
import {
  ReferenceFilesMissingError,
  importReference,
  lookupPincode,
} from "@/server/services/reference";

const FIXTURE = path.resolve(process.cwd(), "tests/fixtures/reference");

describe("reference import", () => {
  it("imports the fixture and is idempotent", async () => {
    const first = await importReference({ dir: FIXTURE, batchSize: 4 });
    expect(first).toMatchObject({ states: 3, pincodes: 10, skipped: 0, unknownStates: [] });
    const second = await importReference({ dir: FIXTURE });
    expect(second.pincodes).toBe(10);

    const db = getDb();
    expect(await db.select().from(states)).toHaveLength(3);
    expect(await db.select().from(pincodes)).toHaveLength(10);

    const [mh] = await db.select().from(states).where(eq(states.code, "27"));
    expect(mh).toMatchObject({
      name: "Maharashtra",
      iso: "IN-MH",
      type: "state",
      zone: "rest_of_india",
    });
    const [delhi] = await db.select().from(states).where(eq(states.code, "07"));
    expect(delhi?.type).toBe("ut");
  });

  it("handles quoted CSV fields and resolves state and zone", async () => {
    await importReference({ dir: FIXTURE });
    const info = await lookupPincode("560003");
    expect(info).toMatchObject({
      district: "Bangalore, Urban",
      stateCode: "29",
      stateName: "Karnataka",
      zone: "metro_region",
      serviceable: true,
      codAllowed: true,
    });
    expect(await lookupPincode("999999")).toBeNull();
    expect(await lookupPincode("abc")).toBeNull();
  });

  it("preserves admin-edited serviceable / cod_allowed flags on re-import", async () => {
    await importReference({ dir: FIXTURE });
    await getDb()
      .update(pincodes)
      .set({ serviceable: false, codAllowed: false })
      .where(eq(pincodes.pincode, "110001"));
    await importReference({ dir: FIXTURE });
    expect(await lookupPincode("110001")).toMatchObject({ serviceable: false, codAllowed: false });
  });

  it("fails with a clear error when files are missing", async () => {
    const err = await importReference({ dir: path.resolve("tests/fixtures/does-not-exist") }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ReferenceFilesMissingError);
    expect((err as ReferenceFilesMissingError).missing).toEqual([
      "states.json",
      "zones.json",
      "pincodes.csv",
    ]);
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_SAVED_ADDRESSES } from "@/features/account/schema";
import { getDb } from "@/server/db";
import { addresses, customerProfiles, user } from "@/server/db/schema";
import {
  createAddress,
  deleteAddress,
  ensureProfile,
  getProfile,
  listAddresses,
  loadCheckoutPrefill,
  setDefaultAddress,
  updateAddress,
  updateProfile,
} from "@/server/services/account";

import { pgErrorCode, PG } from "./helpers/factories";

const db = () => getDb();

const input = (over: Record<string, unknown> = {}) => ({
  name: "Asha Rao",
  phone: "98765 43210",
  line1: "12 Marine Drive",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  ...over,
});

beforeEach(async () => {
  await db()
    .insert(user)
    .values([
      { id: "cust-a", name: "Asha", email: "asha@example.com", emailVerified: true },
      { id: "cust-b", name: "Bela", email: "bela@example.com", emailVerified: true },
    ]);
});

const defaults = async (userId: string) =>
  (await db().select().from(addresses).where(eq(addresses.userId, userId))).filter((a) => a.isDefault);

describe("saved addresses", () => {
  it("makes the first address the default and normalises the phone", async () => {
    const res = await createAddress(db(), "cust-a", input());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ isDefault: true, phone: "+919876543210", pincode: "400001", line2: null });
  });

  it("keeps exactly one default as addresses are added, moved and removed", async () => {
    const a = await createAddress(db(), "cust-a", input({ name: "Home" }));
    const b = await createAddress(db(), "cust-a", input({ name: "Work", isDefault: true }));
    const c = await createAddress(db(), "cust-a", input({ name: "Gran" }));
    if (!a.ok || !b.ok || !c.ok) throw new Error("setup");
    expect((await defaults("cust-a")).map((d) => d.name)).toEqual(["Work"]);
    expect(c.data.isDefault).toBe(false);

    const moved = await setDefaultAddress(db(), "cust-a", c.data.id);
    expect(moved.ok).toBe(true);
    expect((await defaults("cust-a")).map((d) => d.name)).toEqual(["Gran"]);

    // editing an address with "make default" moves the flag too
    const edited = await updateAddress(db(), "cust-a", a.data.id, input({ name: "Home", city: "Pune", isDefault: true }));
    expect(edited.ok && edited.data).toMatchObject({ city: "Pune", isDefault: true });
    expect((await defaults("cust-a")).map((d) => d.name)).toEqual(["Home"]);

    // the default cannot be un-defaulted by editing (the flag only moves)
    const keep = await updateAddress(db(), "cust-a", a.data.id, input({ name: "Home", isDefault: false }));
    expect(keep.ok && keep.data.isDefault).toBe(true);

    // removing the default promotes another one
    expect((await deleteAddress(db(), "cust-a", a.data.id)).ok).toBe(true);
    expect((await defaults("cust-a")).length).toBe(1);
    const list = await listAddresses(db(), "cust-a");
    expect(list).toHaveLength(2);
    expect(list[0]!.isDefault).toBe(true);

    // removing the last one leaves no default and no error
    for (const row of list) await deleteAddress(db(), "cust-a", row.id);
    expect(await listAddresses(db(), "cust-a")).toEqual([]);
  });

  it("the database refuses a second default for a user", async () => {
    const a = await createAddress(db(), "cust-a", input());
    const b = await createAddress(db(), "cust-a", input({ name: "Work" }));
    if (!a.ok || !b.ok) throw new Error("setup");
    const code = await pgErrorCode(
      db().update(addresses).set({ isDefault: true }).where(eq(addresses.id, b.data.id)),
    );
    expect(code).toBe(PG.unique);
  });

  it("validates with the checkout rules and returns field errors", async () => {
    const res = await createAddress(db(), "cust-a", input({ pincode: "012345", phone: "123", name: "A" }));
    expect(res).toMatchObject({ ok: false, code: "invalid" });
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors ?? {}).sort()).toEqual(["name", "phone", "pincode"]);
    expect(await listAddresses(db(), "cust-a")).toHaveLength(0);
  });

  it("limits the number of saved addresses", async () => {
    for (let i = 0; i < MAX_SAVED_ADDRESSES; i++) {
      expect((await createAddress(db(), "cust-a", input({ name: `Addr ${i}` }))).ok).toBe(true);
    }
    const over = await createAddress(db(), "cust-a", input());
    expect(over).toMatchObject({ ok: false, code: "limit" });
  });

  it("never touches another customer's addresses", async () => {
    const mine = await createAddress(db(), "cust-a", input());
    if (!mine.ok) throw new Error("setup");
    expect(await updateAddress(db(), "cust-b", mine.data.id, input({ city: "Hacked" }))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await setDefaultAddress(db(), "cust-b", mine.data.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await deleteAddress(db(), "cust-b", mine.data.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await listAddresses(db(), "cust-b")).toEqual([]);
    expect((await listAddresses(db(), "cust-a"))[0]).toMatchObject({ city: "Mumbai" });
  });
});

describe("profile and checkout prefill", () => {
  it("saves name, phone and the opt-in; the opt-in defaults to off", async () => {
    await ensureProfile(db(), "cust-a");
    await ensureProfile(db(), "cust-a"); // idempotent
    expect(await db().select().from(customerProfiles)).toHaveLength(1);
    expect(await getProfile(db(), "cust-a")).toMatchObject({ phone: null, marketingOptIn: false });

    const res = await updateProfile(db(), "cust-a", { name: "Asha Rao", phone: "9876543210", marketingOptIn: true });
    expect(res.ok && res.data).toMatchObject({ name: "Asha Rao", phone: "+919876543210", marketingOptIn: true });
    expect((await db().select().from(user).where(eq(user.id, "cust-a")))[0]!.name).toBe("Asha Rao");

    // a blank phone clears it
    const cleared = await updateProfile(db(), "cust-a", { name: "Asha Rao", phone: "", marketingOptIn: false });
    expect(cleared.ok && cleared.data).toMatchObject({ phone: null, marketingOptIn: false });
  });

  it("creates the profile row on first save when sign-in did not", async () => {
    const res = await updateProfile(db(), "cust-b", { name: "Bela K", marketingOptIn: false });
    expect(res.ok).toBe(true);
    expect(await db().select().from(customerProfiles).where(eq(customerProfiles.userId, "cust-b"))).toHaveLength(1);
  });

  it("rejects bad input and unknown users", async () => {
    expect(await updateProfile(db(), "cust-a", { name: "", phone: "12" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await updateProfile(db(), "nobody", { name: "Zed Zed" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("gives checkout the saved addresses (default first) and the profile phone", async () => {
    await ensureProfile(db(), "cust-a");
    await updateProfile(db(), "cust-a", { name: "Asha Rao", phone: "9876543210" });
    await createAddress(db(), "cust-a", input({ name: "Home" }));
    await createAddress(db(), "cust-a", input({ name: "Work", isDefault: true }));
    const prefill = await loadCheckoutPrefill(db(), "cust-a");
    expect(prefill.phone).toBe("+919876543210");
    expect(prefill.addresses.map((a) => a.name)).toEqual(["Work", "Home"]);
    expect(await loadCheckoutPrefill(db(), "cust-b")).toEqual({ addresses: [], phone: null });
  });
});

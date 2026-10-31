import { beforeEach, describe, expect, it, vi } from "vitest";

import { getWishlistSync, registerWishlistSync } from "@/features/wishlist/sync";
import { getWishlist, resetWishlistStoreForTests, toggleWishlist } from "@/features/wishlist/store";

const pull = vi.fn();
const push = vi.fn();
vi.mock("@/features/wishlist/account-actions", () => ({
  pullAccountWishlist: () => pull(),
  pushAccountWishlist: (entries: unknown) => push(entries),
}));

const { connectAccountWishlist, goDeviceOnly } = await import("@/features/wishlist/account-sync");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  pull.mockReset();
  push.mockReset();
  push.mockResolvedValue({ ok: true, entries: [] });
  registerWishlistSync(null);
  resetWishlistStoreForTests();
});

describe("account wishlist sync (client side)", () => {
  it("merges the account list into the device list and pushes the union once", async () => {
    toggleWishlist(id(1), 300); // device only
    toggleWishlist(id(2), 200); // on both
    pull.mockResolvedValue({
      ok: true,
      entries: [
        { id: id(2), addedAt: 100 },
        { id: id(3), addedAt: 50 },
      ],
    });

    await connectAccountWishlist();

    expect(getWishlistSync()).not.toBeNull();
    // Earliest save time wins for an id on both sides; newest first.
    expect(getWishlist()).toEqual([
      { id: id(1), addedAt: 300 },
      { id: id(2), addedAt: 100 },
      { id: id(3), addedAt: 50 },
    ]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(getWishlist());
  });

  it("pushes after every later local change", async () => {
    pull.mockResolvedValue({ ok: true, entries: [] });
    await connectAccountWishlist();
    push.mockClear();
    toggleWishlist(id(7), 10);
    expect(push).toHaveBeenCalledWith([{ id: id(7), addedAt: 10 }]);
  });

  it("goes back to device-only when the server says the session is gone", async () => {
    pull.mockResolvedValue({ ok: false, signedIn: false });
    toggleWishlist(id(1), 1);
    await connectAccountWishlist();
    expect(getWishlistSync()).toBeNull();
    expect(getWishlist()).toEqual([{ id: id(1), addedAt: 1 }]);
  });

  it("keeps the sync registered when the pull merely fails", async () => {
    pull.mockResolvedValue({ ok: false, signedIn: true });
    await connectAccountWishlist();
    expect(getWishlistSync()).not.toBeNull();
    goDeviceOnly();
    expect(getWishlistSync()).toBeNull();
  });
});

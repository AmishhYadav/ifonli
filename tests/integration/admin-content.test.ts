import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { loadHelpFaqs } from "@/server/content/policies";
import { getDb } from "@/server/db";
import {
  adminAuditLog,
  banners,
  faqs,
  featuredSlots,
  productImages,
  settings,
  user,
} from "@/server/db/schema";
import {
  bannerState,
  createBanner,
  deleteBanner,
  listBanners,
  liveAnnouncementId,
  moveBanner,
  prepareBannerImageUpload,
  setBannerActive,
  updateBanner,
  verifyBannerImage,
} from "@/server/services/admin/banners";
import {
  createFaq,
  deleteFaq,
  listFaqsAdmin,
  moveFaq,
  setFaqPublished,
  updateFaq,
} from "@/server/services/admin/faq";
import {
  HERO_TILES_MAX,
  getFeaturedAdmin,
  setFeaturedSlots,
} from "@/server/services/admin/featured";
import { AdminInputError } from "@/server/services/admin/products";
import { getFeaturedForAllVibes, getHeroTilesForAllVibes } from "@/server/services/catalog";
import { getActiveBanners, getFaqs } from "@/server/services/content";

import { seedCatalogFixture } from "./catalog-fixture";

vi.mock("@/server/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage")>()),
  createSignedUploadUrl: vi.fn(async (bucket: string, path: string) => ({
    url: `http://storage.test/${bucket}/${path}?token=t`,
    token: "t",
    bucket,
    path,
  })),
}));
const readPublicObject = vi.fn();
const deleteStorageObjects = vi.fn(async () => undefined);
vi.mock("@/server/services/admin/storage", () => ({
  readPublicObject: (...args: unknown[]) => readPublicObject(...args),
  deleteStorageObjects: (...args: unknown[]) => deleteStorageObjects(...(args as [])),
}));

const owner = { id: "owner-1", role: "owner" };
const admin = { id: "admin-1", role: "admin" };
const fulfilment = { id: "ful-1", role: "fulfilment" };

async function actors() {
  await getDb()
    .insert(user)
    .values([
      { id: "owner-1", name: "Owner", email: "owner@example.com", role: "owner" },
      { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
      { id: "ful-1", name: "Packer", email: "ful@example.com", role: "fulfilment" },
    ]);
}

const HOUR = 3600_000;
const iso = (offsetMs: number) =>
  new Date(Date.now() + offsetMs).toISOString().replace("Z", "+00:00");
const base = { placement: "home_offer" as const, title: "Festive sale", active: true };

describe("admin banners", () => {
  it("creates, lists in order, appends new banners last and audits", async () => {
    await actors();
    const a = await createBanner(getDb(), { ...base, title: "A", link: "/shop" }, admin);
    const b = await createBanner(getDb(), { ...base, title: "B", body: "  second  " }, admin);
    const list = await listBanners(getDb());
    expect(list.map((x) => x.title)).toEqual(["A", "B"]);
    expect(list[1]).toMatchObject({ body: "second", state: "live", position: 1, vibeId: null });
    const audits = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "banner.create"));
    expect(audits.map((x) => x.entityId).sort()).toEqual([a.id, b.id].sort());
  });

  it("validates link, schedule, placement rules and image path", async () => {
    await actors();
    const bad = (over: Record<string, unknown>) =>
      createBanner(getDb(), { ...base, ...over }, admin);
    await expect(bad({ title: " " })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ link: "//evil.example" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ link: "javascript:alert(1)" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ link: "http://insecure.example" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ link: "https://ok.example/page" })).resolves.toBeTruthy();
    await expect(bad({ startsAt: iso(2 * HOUR), endsAt: iso(HOUR) })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(bad({ startsAt: "not a date" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ imagePath: "products/x/y.png" })).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ imagePath: "content/banners/../../x.png" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(bad({ imagePath: "content/banners/ok.png" })).resolves.toBeTruthy();
    // The announcement bar is global and image-less.
    const f = await seedCatalogFixture();
    await expect(bad({ placement: "announcement", vibeId: f.vibes.cute })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      bad({ placement: "announcement", imagePath: "content/banners/x.png" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(bad({ vibeId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(
      AdminInputError,
    );
  });

  it("schedule decides what the storefront query returns", async () => {
    await actors();
    const now = new Date();
    await createBanner(getDb(), { ...base, title: "Live" }, admin);
    await createBanner(getDb(), { ...base, title: "Future", startsAt: iso(2 * HOUR) }, admin);
    await createBanner(
      getDb(),
      { ...base, title: "Ended", startsAt: iso(-3 * HOUR), endsAt: iso(-HOUR) },
      admin,
    );
    await createBanner(
      getDb(),
      { ...base, title: "Window", startsAt: iso(-HOUR), endsAt: iso(HOUR) },
      admin,
    );
    const off = await createBanner(getDb(), { ...base, title: "Off", active: false }, admin);

    const shown = (await getActiveBanners(getDb(), { placement: "home_offer", now })).map(
      (b) => b.title,
    );
    expect(shown).toEqual(["Live", "Window"]);

    const states = Object.fromEntries(
      (await listBanners(getDb(), { now })).map((b) => [b.title, b.state]),
    );
    expect(states).toEqual({
      Live: "live",
      Future: "scheduled",
      Ended: "expired",
      Window: "live",
      Off: "inactive",
    });

    // Re-activating Off shows it; two hours on, the future banner appears too.
    await setBannerActive(getDb(), off.id, true, admin);
    expect(
      (await getActiveBanners(getDb(), { placement: "home_offer", now })).map((b) => b.title),
    ).toContain("Off");
    const later = new Date(now.getTime() + 3 * HOUR);
    expect(
      (await getActiveBanners(getDb(), { placement: "home_offer", now: later })).map(
        (b) => b.title,
      ),
    ).toEqual(["Live", "Future", "Off"]);
  });

  it("bannerState boundaries match the storefront (start inclusive, end exclusive)", () => {
    const t = new Date("2026-11-01T10:00:00Z");
    expect(bannerState({ active: true, startsAt: t, endsAt: null }, t)).toBe("live");
    expect(bannerState({ active: true, startsAt: null, endsAt: t }, t)).toBe("expired");
    expect(bannerState({ active: false, startsAt: null, endsAt: null }, t)).toBe("inactive");
  });

  it("targets a vibe: vibe banners show only for that vibe; global for all", async () => {
    await actors();
    const f = await seedCatalogFixture();
    await createBanner(getDb(), { ...base, title: "Everyone" }, admin);
    await createBanner(getDb(), { ...base, title: "Goth only", vibeId: f.vibes.gothic }, admin);
    const now = new Date();
    const titles = async (vibe?: string) =>
      (await getActiveBanners(getDb(), { placement: "home_offer", vibe, now })).map((b) => b.title);
    expect(await titles()).toEqual(["Everyone"]);
    expect(await titles("cute")).toEqual(["Everyone"]);
    expect((await titles("gothic")).sort()).toEqual(["Everyone", "Goth only"]);
  });

  it("moves banners up and down within a placement; storefront order follows", async () => {
    await actors();
    const a = await createBanner(getDb(), { ...base, title: "A" }, admin);
    const b = await createBanner(getDb(), { ...base, title: "B" }, admin);
    const c = await createBanner(getDb(), { ...base, title: "C" }, admin);
    const other = await createBanner(getDb(), { placement: "announcement", title: "Bar" }, admin);
    await moveBanner(getDb(), c.id, "up", admin);
    expect((await listBanners(getDb(), { placement: "home_offer" })).map((x) => x.title)).toEqual([
      "A",
      "C",
      "B",
    ]);
    await moveBanner(getDb(), c.id, "up", admin);
    await moveBanner(getDb(), c.id, "up", admin); // already first: no-op
    expect((await listBanners(getDb(), { placement: "home_offer" })).map((x) => x.title)).toEqual([
      "C",
      "A",
      "B",
    ]);
    await moveBanner(getDb(), a.id, "down", admin);
    const order = (
      await getActiveBanners(getDb(), { placement: "home_offer", now: new Date() })
    ).map((x) => x.title);
    expect(order).toEqual(["C", "B", "A"]);
    expect((await listBanners(getDb(), { placement: "announcement" }))[0]?.id).toBe(other.id);
    expect(b.id).toBeTruthy();
  });

  it("the announcement bar shows the first live global announcement", async () => {
    await actors();
    await createBanner(
      getDb(),
      { placement: "announcement", title: "Old", endsAt: iso(-HOUR), startsAt: iso(-5 * HOUR) },
      admin,
    );
    const live = await createBanner(
      getDb(),
      { placement: "announcement", title: "Free shipping" },
      admin,
    );
    await createBanner(getDb(), { placement: "announcement", title: "Second" }, admin);
    const list = await listBanners(getDb(), { placement: "announcement" });
    expect(liveAnnouncementId(list)).toBe(live.id);
    const shown = await getActiveBanners(getDb(), { placement: "announcement", now: new Date() });
    expect(shown[0]?.title).toBe("Free shipping");
  });

  it("updates (diff audited), blocks changing placement, deletes", async () => {
    await actors();
    const a = await createBanner(getDb(), { ...base, title: "Before" }, admin);
    await updateBanner(getDb(), a.id, { ...base, title: "After", link: "/shop" }, admin);
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "banner.update"));
    expect(audit?.diff).toMatchObject({
      title: { from: "Before", to: "After" },
      link: { from: null, to: "/shop" },
    });
    await expect(
      updateBanner(getDb(), a.id, { ...base, placement: "announcement" }, admin),
    ).rejects.toThrow(/cannot move/);
    await expect(
      updateBanner(getDb(), "00000000-0000-4000-8000-000000000000", base, admin),
    ).rejects.toThrow(/not found/);
    await deleteBanner(getDb(), a.id, admin);
    expect(await getDb().select().from(banners)).toHaveLength(0);
    await expect(deleteBanner(getDb(), a.id, admin)).rejects.toThrow(/not found/);
  });

  it("needs content:manage (fulfilment is refused)", async () => {
    await actors();
    await expect(createBanner(getDb(), base, fulfilment)).rejects.toThrow(/Forbidden/);
    const a = await createBanner(getDb(), base, owner);
    await expect(setBannerActive(getDb(), a.id, false, fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(moveBanner(getDb(), a.id, "down", fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(deleteBanner(getDb(), a.id, fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(prepareBannerImageUpload({ extension: "png" }, fulfilment)).rejects.toThrow(
      /Forbidden/,
    );
  });

  it("image upload: signed path in content/banners, extension and path checks, orphan cleanup", async () => {
    await actors();
    const prep = await prepareBannerImageUpload({ extension: ".PNG" }, admin);
    expect(prep.dbPath).toMatch(/^content\/banners\/[0-9a-f-]{36}\.png$/);
    expect(prep.bucket).toBe("content");
    await expect(prepareBannerImageUpload({ extension: "svg" }, admin)).rejects.toThrow(
      /JPEG, PNG, WebP or AVIF/,
    );
    await expect(verifyBannerImage({ dbPath: "products/1/a.png" }, admin)).rejects.toThrow(
      /Unexpected upload path/,
    );
    await expect(verifyBannerImage({ dbPath: "content/banners/../a.png" }, admin)).rejects.toThrow(
      /Unexpected upload path/,
    );

    // An unreadable object is rejected and removed from storage.
    readPublicObject.mockResolvedValueOnce(Buffer.from("not an image"));
    await expect(verifyBannerImage({ dbPath: prep.dbPath }, admin)).rejects.toThrow(
      /not a readable image/,
    );
    expect(deleteStorageObjects).toHaveBeenCalledWith("content", [
      prep.dbPath.slice("content/".length),
    ]);

    // Replacing the image deletes the old object once nothing else uses it.
    deleteStorageObjects.mockClear();
    const a = await createBanner(getDb(), { ...base, imagePath: "content/banners/old.png" }, admin);
    await updateBanner(getDb(), a.id, { ...base, imagePath: "content/banners/new.png" }, admin);
    expect(deleteStorageObjects).toHaveBeenCalledWith("content", ["banners/old.png"]);
    deleteStorageObjects.mockClear();
    await deleteBanner(getDb(), a.id, admin);
    expect(deleteStorageObjects).toHaveBeenCalledWith("content", ["banners/new.png"]);
  });
});

describe("admin featured and hero slots", () => {
  it("sets home featured per vibe in order; the storefront follows it", async () => {
    await actors();
    const f = await seedCatalogFixture();
    const ids = [f.products["cat-sticker"]!, f.products["heart-charm"]!];
    await setFeaturedSlots(
      getDb(),
      { vibeId: f.vibes.cute, placement: "home_featured", productIds: ids },
      admin,
    );
    let sets = await getFeaturedForAllVibes(getDb(), 8);
    expect(sets.cute?.map((p) => p.slug)).toEqual(["cat-sticker", "heart-charm"]);

    await setFeaturedSlots(
      getDb(),
      { vibeId: f.vibes.cute, placement: "home_featured", productIds: [...ids].reverse() },
      admin,
    );
    sets = await getFeaturedForAllVibes(getDb(), 8);
    expect(sets.cute?.map((p) => p.slug)).toEqual(["heart-charm", "cat-sticker"]);
    const rows = await getDb().select().from(featuredSlots);
    expect(rows.map((r) => r.rank).sort()).toEqual([0, 1]);

    // Clearing falls back to the vibe's products.
    await setFeaturedSlots(
      getDb(),
      { vibeId: f.vibes.cute, placement: "home_featured", productIds: [] },
      admin,
    );
    expect(await getDb().select().from(featuredSlots)).toHaveLength(0);
    sets = await getFeaturedForAllVibes(getDb(), 8);
    expect((sets.cute ?? []).length).toBeGreaterThan(0);
    const [audit] = await getDb()
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, "featured.set"));
    expect(audit?.entity).toBe("vibe");
  });

  it("rejects duplicates, archived and unknown products, too many, and non-content roles", async () => {
    await actors();
    const f = await seedCatalogFixture();
    const p = f.products["skull-charm"]!;
    const set = (productIds: string[], who = admin, placement = "home_featured") =>
      setFeaturedSlots(getDb(), { vibeId: f.vibes.cute, placement, productIds }, who);
    await expect(set([p, p])).rejects.toThrow(/twice/);
    await expect(set(["00000000-0000-4000-8000-000000000000"])).rejects.toThrow(/no longer exists/);
    await expect(set([p], fulfilment)).rejects.toThrow(/Forbidden/);
    await expect(set([p], admin, "banner")).rejects.toBeInstanceOf(ZodError);
    await expect(
      setFeaturedSlots(
        getDb(),
        {
          vibeId: "00000000-0000-4000-8000-000000000000",
          placement: "home_featured",
          productIds: [],
        },
        admin,
      ),
    ).rejects.toThrow(/Vibe not found/);
    await getDb()
      .update((await import("@/server/db/schema")).products)
      .set({ status: "archived" })
      .where(eq((await import("@/server/db/schema")).products.id, p));
    await expect(set([p])).rejects.toThrow(/Archived/);
    const many = Array.from({ length: HERO_TILES_MAX + 1 }, () => crypto.randomUUID());
    await expect(set(many, admin, "hero_tiles")).rejects.toThrow(/At most/);
  });

  it("hero tiles: curated order wins, products without cutouts are flagged, warning count per vibe", async () => {
    await actors();
    const f = await seedCatalogFixture();
    // Gothic: curated skull (cutout) + ghost (no cutout).
    await setFeaturedSlots(
      getDb(),
      {
        vibeId: f.vibes.gothic,
        placement: "hero_tiles",
        productIds: [f.products["ghost-sticker"]!, f.products["skull-charm"]!],
      },
      admin,
    );
    const tiles = await getHeroTilesForAllVibes(getDb(), 14);
    expect(tiles.gothic?.map((t) => t.slug)).toEqual(["skull-charm"]); // ghost has no cutout

    const data = await getFeaturedAdmin(getDb());
    const gothic = data.vibes.find((v) => v.slug === "gothic")!;
    expect(gothic.hero.map((p) => [p.slug, p.hasCutout])).toEqual([
      ["ghost-sticker", false],
      ["skull-charm", true],
    ]);
    expect(gothic.heroStats).toMatchObject({
      needed: 8,
      effective: 1,
      usingFallback: false,
      warning: true,
    });
    // Cute has no curated tiles: fallback to its products with cutouts (heart only).
    const cute = data.vibes.find((v) => v.slug === "cute")!;
    expect(cute.heroStats).toMatchObject({ effective: 1, usingFallback: true, warning: true });
    expect(data.candidates.some((p) => p.slug === "draft-thing")).toBe(true);
  });

  it("counts placeholder cutouts among the effective tiles", async () => {
    await actors();
    const f = await seedCatalogFixture();
    await getDb()
      .update(productImages)
      .set({ isPlaceholder: true })
      .where(eq(productImages.productId, f.products["heart-charm"]!));
    const data = await getFeaturedAdmin(getDb());
    const cute = data.vibes.find((v) => v.slug === "cute")!;
    expect(cute.heroStats.placeholderTiles).toBe(1);
  });
});

describe("admin FAQ", () => {
  const faq = {
    category: "delivery" as const,
    question: "How long?",
    answerMd: "A **few** days.",
    published: true,
  };

  it("creates, orders within category, edits, publishes and deletes; /help follows", async () => {
    await actors();
    const a = await createFaq(getDb(), faq, admin);
    const b = await createFaq(getDb(), { ...faq, question: "Where from?" }, admin);
    const c = await createFaq(
      getDb(),
      { ...faq, category: "payment", question: "Pay how?" },
      admin,
    );

    expect(
      (await getFaqs(getDb())).map((g) => [g.category, g.items.map((i) => i.question)]),
    ).toEqual([
      ["delivery", ["How long?", "Where from?"]],
      ["payment", ["Pay how?"]],
    ]);

    await moveFaq(getDb(), b.id, "up", admin);
    expect(
      (await listFaqsAdmin(getDb()))
        .filter((x) => x.category === "delivery")
        .map((x) => x.question),
    ).toEqual(["Where from?", "How long?"]);
    await moveFaq(getDb(), b.id, "up", admin); // first already: no-op
    await moveFaq(getDb(), c.id, "down", admin); // last in its category: no-op

    await updateFaq(getDb(), a.id, { ...faq, question: "How long does delivery take?" }, admin);
    const help = await loadHelpFaqs(getDb(), { review: false });
    expect(help[0]?.items.map((i) => i.question)).toEqual([
      "Where from?",
      "How long does delivery take?",
    ]);
    expect(help[0]?.items[1]?.html).toContain("<strong>few</strong>");

    // Unpublish hides it from /help; moving category appends to the new category.
    await setFaqPublished(getDb(), a.id, false, admin);
    expect(
      (await loadHelpFaqs(getDb(), { review: false }))[0]?.items.map((i) => i.question),
    ).toEqual(["Where from?"]);
    await updateFaq(getDb(), a.id, { ...faq, category: "orders", published: true }, admin);
    expect((await listFaqsAdmin(getDb())).find((x) => x.id === a.id)).toMatchObject({
      category: "orders",
      position: 1,
    });

    await deleteFaq(getDb(), c.id, admin);
    expect(await getDb().select().from(faqs)).toHaveLength(2);
    const actions = (await getDb().select().from(adminAuditLog)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "faq.create",
        "faq.update",
        "faq.unpublish",
        "faq.reorder",
        "faq.delete",
      ]),
    );
  });

  it("validates input, needs content:manage and reports token problems", async () => {
    await actors();
    await expect(createFaq(getDb(), { ...faq, question: " " }, admin)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createFaq(getDb(), { ...faq, answerMd: "" }, admin)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createFaq(getDb(), { ...faq, category: "returns" }, admin)).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createFaq(getDb(), faq, fulfilment)).rejects.toThrow(/Forbidden/);
    const a = await createFaq(
      getDb(),
      { ...faq, answerMd: "Ships in {{settings.processing_days}} days via {{settings.nope}}." },
      owner,
    );
    const row = (await listFaqsAdmin(getDb())).find((x) => x.id === a.id)!;
    // processing_days is unset (placeholder, required) and `nope` does not exist.
    expect(row.problems.map((p) => p.kind).sort()).toEqual(["placeholder", "unresolved"]);
    await getDb()
      .insert(settings)
      .values({ key: "processing_days", value: 2, isPlaceholder: false });
    const after = (await listFaqsAdmin(getDb())).find((x) => x.id === a.id)!;
    expect(after.problems.map((p) => p.token)).toEqual(["settings.nope"]);
    await expect(
      setFaqPublished(getDb(), "00000000-0000-4000-8000-000000000000", true, admin),
    ).rejects.toThrow(/not found/);
  });
});

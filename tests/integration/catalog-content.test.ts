import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db";
import { banners, faqs, policies, policyVersions, vibes } from "@/server/db/schema";
import { getActiveBanners, getFaqs, getPolicy, listPublishedPolicies } from "@/server/services/content";

const db = () => getDb();
const NOW = new Date("2026-11-15T12:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

async function makeVibes() {
  const rows = await db()
    .insert(vibes)
    .values([
      { slug: "cute", name: "Cute", sort: 1 },
      { slug: "gothic", name: "Gothic", sort: 2 },
    ])
    .returning();
  return Object.fromEntries(rows.map((r) => [r.slug, r.id])) as Record<"cute" | "gothic", string>;
}

type BannerInput = Partial<typeof banners.$inferInsert> & { title: string };
async function banner(input: BannerInput) {
  await db()
    .insert(banners)
    .values({ placement: "home_offer", ...input });
}

describe("getActiveBanners", () => {
  it("honours the schedule window and the active flag", async () => {
    await banner({ title: "always" });
    await banner({ title: "started", startsAt: at(-2), endsAt: at(2) });
    await banner({ title: "open-ended start", startsAt: at(-1) });
    await banner({ title: "open-ended end", endsAt: at(1) });
    await banner({ title: "future", startsAt: at(1) });
    await banner({ title: "expired", startsAt: at(-5), endsAt: at(-1) });
    await banner({ title: "ends exactly now", startsAt: at(-5), endsAt: NOW });
    await banner({ title: "starts exactly now", startsAt: NOW });
    await banner({ title: "switched off", active: false });
    const titles = (await getActiveBanners(db(), { placement: "home_offer", now: NOW })).map((b) => b.title);
    expect(titles.sort()).toEqual(
      ["always", "started", "open-ended start", "open-ended end", "starts exactly now"].sort(),
    );
  });

  it("returns vibe-specific plus global banners for a vibe, global only without one", async () => {
    const v = await makeVibes();
    await banner({ title: "global", position: 5 });
    await banner({ title: "cute only", vibeId: v.cute, position: 5 });
    await banner({ title: "gothic only", vibeId: v.gothic, position: 1 });

    const cute = await getActiveBanners(db(), { placement: "home_offer", vibe: "cute", now: NOW });
    // same position: vibe-specific before global
    expect(cute.map((b) => [b.title, b.vibeSlug])).toEqual([
      ["cute only", "cute"],
      ["global", null],
    ]);
    const gothic = await getActiveBanners(db(), { placement: "home_offer", vibe: "gothic", now: NOW });
    expect(gothic.map((b) => b.title)).toEqual(["gothic only", "global"]); // position 1 first
    const none = await getActiveBanners(db(), { placement: "home_offer", now: NOW });
    expect(none.map((b) => b.title)).toEqual(["global"]);
  });

  it("filters by placement and orders by position", async () => {
    await banner({ title: "b", position: 2 });
    await banner({ title: "a", position: 1 });
    await banner({ title: "bar", placement: "announcement" });
    expect((await getActiveBanners(db(), { placement: "home_offer", now: NOW })).map((b) => b.title)).toEqual([
      "a",
      "b",
    ]);
    const ann = await getActiveBanners(db(), { placement: "announcement", now: NOW });
    expect(ann.map((b) => b.title)).toEqual(["bar"]);
    expect(ann[0]).not.toHaveProperty("createdAt");
  });
});

describe("getFaqs", () => {
  it("groups published FAQs by category in a fixed order, by position", async () => {
    await db()
      .insert(faqs)
      .values([
        { category: "orders", question: "Where is my order?", answerMd: "a", position: 0 },
        { category: "delivery", question: "Second", answerMd: "a", position: 2 },
        { category: "delivery", question: "First", answerMd: "a", position: 1 },
        { category: "delivery", question: "Hidden", answerMd: "a", position: 0, published: false },
      ]);
    const groups = await getFaqs(db());
    expect(groups.map((g) => g.category)).toEqual(["delivery", "orders"]); // payment/product empty
    expect(groups[0]!.items.map((i) => i.question)).toEqual(["First", "Second"]);
  });

  it("is empty when nothing is published", async () => {
    expect(await getFaqs(db())).toEqual([]);
  });
});

describe("getPolicy", () => {
  it("returns a published policy", async () => {
    await db()
      .insert(policies)
      .values({ slug: "shipping", title: "Shipping", bodyMd: "# Ship", version: 3, published: true });
    expect(await getPolicy(db(), "shipping")).toMatchObject({
      slug: "shipping",
      title: "Shipping",
      bodyMd: "# Ship",
      version: 3,
    });
  });

  it("serves the newest history version while the current row is unpublished", async () => {
    const [p] = await db()
      .insert(policies)
      .values({ slug: "returns-refunds", title: "Returns (draft)", bodyMd: "draft", version: 3, published: false })
      .returning();
    await db().insert(policyVersions).values([
      { policyId: p!.id, version: 1, title: "Returns v1", bodyMd: "one" },
      { policyId: p!.id, version: 2, title: "Returns v2", bodyMd: "two" },
    ]);
    expect(await getPolicy(db(), "returns-refunds")).toMatchObject({ version: 2, title: "Returns v2", bodyMd: "two" });
    expect(await listPublishedPolicies(db())).toEqual([{ slug: "returns-refunds", title: "Returns v2" }]);
  });

  it("is null for unknown slugs and never-published policies", async () => {
    await db().insert(policies).values({ slug: "privacy", title: "Privacy", published: false });
    expect(await getPolicy(db(), "privacy")).toBeNull();
    expect(await getPolicy(db(), "nope")).toBeNull();
    expect(await listPublishedPolicies(db())).toEqual([]);
  });
});

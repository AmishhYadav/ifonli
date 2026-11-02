import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createSql } from "./helpers/db";
import { makeProduct } from "./helpers/factories";

/**
 * Migration 0006: Overthinking is removed, the remaining vibes are renamed (slugs stay), products that only
 * had Overthinking move to Chaos Cabinet, and the vibe settings drop the old slug. The empty-database run is
 * already proven by the integration global setup; here the data statements run against old-style rows.
 */
const sql = createSql();
afterAll(() => sql.end());

const statements = readFileSync(path.resolve(process.cwd(), "drizzle/0006_four_moods.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

async function runMigration() {
  for (const s of statements) await sql.unsafe(s);
}

async function seedOldWorld() {
  const old = [
    {
      slug: "cute",
      name: "Cute",
      sort: 1,
      description: "PLACEHOLDER — short description of the Cute vibe",
    },
    { slug: "bold", name: "Bold", sort: 2, description: "Edited by the owner, keep me" },
    { slug: "overthinking", name: "Overthinking", sort: 3, description: null },
    { slug: "gothic", name: "Gothic", sort: 4, description: null },
    { slug: "funky", name: "Funky", sort: 5, description: null },
  ];
  const ids: Record<string, string> = {};
  for (const v of old) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO vibes (slug, name, sort, description)
      VALUES (${v.slug}, ${v.name}, ${v.sort}, ${v.description}) RETURNING id`;
    ids[v.slug] = row!.id;
  }
  return ids;
}

describe("migration 0006: four moods", () => {
  it("renames, re-sorts, re-files and deletes without touching owner-edited copy", async () => {
    const ids = await seedOldWorld();
    const onlyOver = await makeProduct({ slug: "only-over", name: "Only Over" });
    const overAndGothic = await makeProduct({ slug: "over-gothic", name: "Over Gothic" });
    await sql`
      INSERT INTO product_vibes (product_id, vibe_id, featured_rank) VALUES
        (${onlyOver.id}, ${ids.overthinking!}, 1),
        (${overAndGothic.id}, ${ids.overthinking!}, 2),
        (${overAndGothic.id}, ${ids.gothic!}, 3)`;
    await sql`
      INSERT INTO settings (key, value) VALUES
        ('vibe_cycle', '["cute","bold","overthinking","gothic","funky"]'::jsonb),
        ('default_vibe', '"overthinking"'::jsonb)`;

    await runMigration();

    const vibeRows = await sql<
      { slug: string; name: string; sort: number; description: string | null }[]
    >`
      SELECT slug, name, sort, description FROM vibes ORDER BY sort`;
    expect(vibeRows.map((v) => [v.slug, v.name, v.sort])).toEqual([
      ["cute", "Mochi", 1],
      ["funky", "Chaos Cabinet", 2],
      ["bold", "Unapologetic", 3],
      ["gothic", "After the Dark", 4],
    ]);
    // Placeholder / unset copy is refreshed; the owner's own text is kept.
    expect(vibeRows.find((v) => v.slug === "cute")!.description).toMatch(
      /^Soft, sweet and a little bit squishy/,
    );
    expect(vibeRows.find((v) => v.slug === "gothic")!.description).toMatch(
      /^For souls who bloom at midnight/,
    );
    expect(vibeRows.find((v) => v.slug === "bold")!.description).toBe(
      "Edited by the owner, keep me",
    );

    const links = await sql<{ slug: string; vibe: string; rank: number | null }[]>`
      SELECT p.slug, v.slug AS vibe, pv.featured_rank AS rank
      FROM product_vibes pv JOIN products p ON p.id = pv.product_id JOIN vibes v ON v.id = pv.vibe_id
      ORDER BY p.slug, v.slug`;
    expect(links).toEqual([
      { slug: "only-over", vibe: "funky", rank: null },
      { slug: "over-gothic", vibe: "gothic", rank: 3 },
    ]);

    const settings = await sql<{ key: string; value: unknown }[]>`
      SELECT key, value FROM settings ORDER BY key`;
    expect(settings).toEqual([
      { key: "default_vibe", value: "cute" },
      { key: "vibe_cycle", value: ["cute", "gothic", "funky", "bold"] },
    ]);
  });

  it("is safe to run twice and leaves a custom cycle that never held Overthinking alone", async () => {
    await seedOldWorld();
    await sql`
      INSERT INTO settings (key, value) VALUES
        ('vibe_cycle', '["gothic","cute"]'::jsonb), ('default_vibe', '"random"'::jsonb)`;
    await runMigration();
    await runMigration();
    const settings = await sql<
      { key: string; value: unknown }[]
    >`SELECT key, value FROM settings ORDER BY key`;
    expect(settings).toEqual([
      { key: "default_vibe", value: "random" },
      { key: "vibe_cycle", value: ["gothic", "cute"] },
    ]);
    const counted = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM vibes`;
    expect(counted[0]?.n).toBe(4);
  });

  it("works on an empty database (no vibes, no settings)", async () => {
    await expect(runMigration()).resolves.toBeUndefined();
  });
});

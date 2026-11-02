-- Four moods: Overthinking is removed and the remaining vibes get their new display names.
-- Slugs (cute, bold, gothic, funky) are unchanged, so URLs, cookies and product links keep working.
--   cute -> Mochi, funky -> Chaos Cabinet, bold -> Unapologetic, gothic -> After the Dark
-- Idempotent: every statement is a no-op once it has run, and it also runs cleanly on an empty database.

-- (a) Products whose ONLY vibe is Overthinking move to Chaos Cabinet (not featured there: featured_rank stays NULL).
INSERT INTO "product_vibes" ("product_id", "vibe_id", "featured_rank")
SELECT pv."product_id", f."id", NULL
FROM "product_vibes" pv
JOIN "vibes" o ON o."id" = pv."vibe_id" AND o."slug" = 'overthinking'
JOIN "vibes" f ON f."slug" = 'funky'
WHERE NOT EXISTS (
  SELECT 1 FROM "product_vibes" other
  WHERE other."product_id" = pv."product_id" AND other."vibe_id" <> o."id"
)
ON CONFLICT ("product_id", "vibe_id") DO NOTHING;--> statement-breakpoint

-- (b) Delete the vibe. product_vibes, featured_slots and vibe-scoped banners cascade.
DELETE FROM "vibes" WHERE "slug" = 'overthinking';--> statement-breakpoint

-- (c) New names and nav order: cute 1, funky 2, bold 3, gothic 4.
UPDATE "vibes" SET "name" = 'Mochi', "sort" = 1 WHERE "slug" = 'cute';--> statement-breakpoint
UPDATE "vibes" SET "name" = 'Chaos Cabinet', "sort" = 2 WHERE "slug" = 'funky';--> statement-breakpoint
UPDATE "vibes" SET "name" = 'Unapologetic', "sort" = 3 WHERE "slug" = 'bold';--> statement-breakpoint
UPDATE "vibes" SET "name" = 'After the Dark', "sort" = 4 WHERE "slug" = 'gothic';--> statement-breakpoint

-- Copy is refreshed only where it still holds the text we shipped (the seed placeholder or the original store
-- values), so anything the owner edited is left alone.
UPDATE "vibes" SET "description" = 'Soft, sweet and a little bit squishy. Pastel colours, tiny shapes and happy little details for anyone whose bag, phone or hair clip should look like a good mood.'
WHERE "slug" = 'cute' AND ("description" IS NULL OR "description" LIKE 'PLACEHOLDER%'
  OR "description" = 'Soft colours, tiny shapes and happy little details. Charms, Hippers and stickers for anyone whose bag, phone or hair clip should look like a good mood.');--> statement-breakpoint
UPDATE "vibes" SET "seo_title" = 'Mochi: soft, cute charms and stickers'
WHERE "slug" = 'cute' AND ("seo_title" IS NULL OR "seo_title" = 'Cute charms, Hippers and 3D stickers');--> statement-breakpoint

UPDATE "vibes" SET "description" = 'Funky, quirky and gloriously unhinged. Retro swirls, bright clashes and playful oddities that turn a plain tote or phone case into a party.'
WHERE "slug" = 'funky' AND ("description" IS NULL OR "description" LIKE 'PLACEHOLDER%'
  OR "description" = 'Retro swirls, bright clashes and seventies energy. Playful pieces that turn a plain tote or phone case into a groove.');--> statement-breakpoint
UPDATE "vibes" SET "seo_title" = 'Chaos Cabinet: funky, quirky charms'
WHERE "slug" = 'funky' AND ("seo_title" IS NULL OR "seo_title" = 'Funky retro charms, Hippers and stickers');--> statement-breakpoint
UPDATE "vibes" SET "seo_desc" = 'Bright, quirky, retro-inspired charms, Hippers, 3D stickers and DIY kits for people who like a little chaos. Cash on delivery available.'
WHERE "slug" = 'funky' AND ("seo_desc" IS NULL
  OR "seo_desc" = 'Bright, retro-inspired charms, Hippers, 3D stickers and DIY kits with serious seventies energy. Cash on delivery available.');--> statement-breakpoint

UPDATE "vibes" SET "description" = 'Main character energy only. Black, red and loud pieces for people who want their bag, jacket or hair clip to be noticed from across the room.'
WHERE "slug" = 'bold' AND ("description" IS NULL OR "description" LIKE 'PLACEHOLDER%'
  OR "description" = 'Loud colours, chunky shapes and no apologies. Pieces for people who want their bag, jacket or hair clip to be noticed from across the room.');--> statement-breakpoint
UPDATE "vibes" SET "seo_title" = 'Unapologetic: bold charms and stickers'
WHERE "slug" = 'bold' AND ("seo_title" IS NULL OR "seo_title" = 'Bold charms, Hippers and 3D stickers');--> statement-breakpoint

UPDATE "vibes" SET "description" = 'For souls who bloom at midnight. Dark enamel, silver tones and a little drama for people who prefer moonlight to sunshine.'
WHERE "slug" = 'gothic' AND ("description" IS NULL OR "description" LIKE 'PLACEHOLDER%'
  OR "description" = 'Dark enamel, silver tones and a little drama. Charms and clips for people who prefer moonlight to sunshine.');--> statement-breakpoint
UPDATE "vibes" SET "seo_title" = 'After the Dark: moody charms and stickers'
WHERE "slug" = 'gothic' AND ("seo_title" IS NULL OR "seo_title" = 'Gothic charms, Hippers and 3D stickers');--> statement-breakpoint

-- The Charms type's SEO description listed the five old vibe names.
UPDATE "product_types" SET "seo_desc" = 'Shop charms in every vibe: Mochi, Chaos Cabinet, Unapologetic and After the Dark. Enamel, resin and acrylic details on zinc alloy or steel.'
WHERE "slug" = 'charms' AND "seo_desc" = 'Shop charms in every vibe: cute, bold, overthinking, gothic and funky. Enamel, resin and acrylic details on zinc alloy or steel.';--> statement-breakpoint

-- (d) Settings (jsonb): drop Overthinking from the hand-button cycle and from the default vibe.
UPDATE "settings" SET "value" = '["cute","gothic","funky","bold"]'::jsonb, "updated_at" = now()
WHERE "key" = 'vibe_cycle' AND "value"::text LIKE '%overthinking%';--> statement-breakpoint
UPDATE "settings" SET "value" = '"cute"'::jsonb, "updated_at" = now()
WHERE "key" = 'default_vibe' AND "value" = '"overthinking"'::jsonb;

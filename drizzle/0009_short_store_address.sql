-- Store address: show only the locality, city, state and pincode ("Yelahanka, Bengaluru, Karnataka – 560064, India").
-- Updates the live settings (footer, store details, policies, e-mails, new invoices), any product manufacturer override,
-- and the seller address frozen in existing invoice snapshots so past orders show it too.
-- Idempotent: every statement only touches rows that still carry the old campus address.

UPDATE "settings"
SET "value" = to_jsonb('Yelahanka, Bengaluru, Karnataka – 560064, India'::text), "updated_at" = now()
WHERE "key" = 'registered_address' AND "value" #>> '{}' LIKE '%Govindapura%';--> statement-breakpoint

UPDATE "settings"
SET "value" = jsonb_set("value", '{address}', to_jsonb('Yelahanka, Bengaluru, Karnataka – 560064, India'::text)), "updated_at" = now()
WHERE "key" = 'default_manufacturer' AND "value" ->> 'address' LIKE '%Govindapura%';--> statement-breakpoint

UPDATE "products"
SET "manufacturer_override" = jsonb_set("manufacturer_override", '{address}', to_jsonb('Yelahanka, Bengaluru, Karnataka – 560064, India'::text))
WHERE "manufacturer_override" ->> 'address' LIKE '%Govindapura%';--> statement-breakpoint

UPDATE "invoices"
SET "snapshot" = jsonb_set("snapshot", '{seller,address}', to_jsonb('Yelahanka, Bengaluru, Karnataka – 560064, India'::text))
WHERE "snapshot" -> 'seller' ->> 'address' LIKE '%Govindapura%';

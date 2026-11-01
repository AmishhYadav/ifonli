CREATE TABLE "product_slug_redirects" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_slug_redirects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_engagement_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "two_factor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bundle_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_option_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_vibes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vibes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "banners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "faqs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "featured_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wishlist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pincodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "stock_reservations_order_idx";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "password_change_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_slug_redirects" ADD CONSTRAINT "product_slug_redirects_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_slug_redirects_product_idx" ON "product_slug_redirects" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_order_variant_uq" ON "stock_reservations" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_paying_capture_uq" ON "payments" USING btree ("order_id") WHERE "payments"."status" = 'captured' AND "payments"."raw" ->> 'disposition' IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Everything below is hand-written (Drizzle cannot express it) and is part of this migration.
-- ---------------------------------------------------------------------------------------------

-- 1. PostgREST lockdown. Hosted Supabase's default ACL gives `anon` and `authenticated` full CRUD on
--    every new table in `public` and exposes them through the Data API with the public anon key.
--    The app never uses that API: it connects as the table owner (`postgres`) over Postgres, which
--    RLS does not apply to. So (a) RLS is on for every table (above, deny-all because there are no
--    policies) and (b) both roles lose every privilege, today and for tables created later.
--    `service_role` is left alone on purpose: it is the server-side key (it also bypasses RLS), it is
--    never shipped to a browser, and Supabase's own server-side tooling expects it to work; locking
--    it out would add nothing against the public key and could break that tooling.
--    Plain Postgres (CI, the integration tests) has none of these roles, hence the existence checks.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- Tables, sequences and functions created later by the migrating role must not get the grants back.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') AND pg_has_role('postgres', 'member') THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
      END IF;
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint

-- 2. `admin_audit_log` is append-only. UPDATE and DELETE are rejected, with one exception: the
--    `ON DELETE SET NULL` of `actor_id` (a deleted staff or customer account) is an UPDATE that only
--    clears `actor_id` and leaves every other column untouched, and that exact change is allowed so
--    accounts can still be erased (DPDP). Row triggers do not fire on TRUNCATE, which the test
--    suites rely on to reset between tests; it needs table-owner rights, which the app role has but
--    no API role does.
CREATE FUNCTION public.admin_audit_log_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.actor_id IS NOT NULL
     AND NEW.actor_id IS NULL
     AND (NEW.id, NEW.action, NEW.entity, NEW.entity_id, NEW.diff, NEW.ip, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.action, OLD.entity, OLD.entity_id, OLD.diff, OLD.ip, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_audit_log is append-only (% rejected)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_guard();--> statement-breakpoint

-- 3. "Must change password" moves from Better Auth's `verification` table (identifier
--    `must-change-password:<userId>`, deadline in `value`) to `user.password_change_deadline`.
--    A marker whose value is not an ISO timestamp counted as expired before, so it becomes the epoch.
UPDATE "user" AS u
SET password_change_deadline = CASE
  WHEN v.value ~ '^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$' THEN v.value::timestamptz
  ELSE to_timestamp(0)
END
FROM "verification" AS v
WHERE v.identifier = 'must-change-password:' || u.id;--> statement-breakpoint
DELETE FROM "verification" WHERE left(identifier, 21) = 'must-change-password:';

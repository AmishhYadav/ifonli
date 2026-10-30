-- Extensions and helpers needed by the schema. Installed in `public` so that plain Postgres
-- (CI, ifonli_test) and Supabase behave identically and operator classes (gin_trgm_ops)
-- resolve without search_path tweaks.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;--> statement-breakpoint

-- unaccent() is only STABLE, so it cannot be used in a generated column or index expression.
-- The wrapper pins the dictionary and is declared IMMUTABLE (the dictionary never changes in
-- practice). Used by products.search_tsv.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, input) $$;

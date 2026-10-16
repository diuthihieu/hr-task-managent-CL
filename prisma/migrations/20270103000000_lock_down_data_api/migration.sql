-- Lock the tables down for every role except the app's own.
--
-- The app talks to PostgreSQL directly (Prisma, as the table owner), never
-- through a hosted data API. On Supabase, though, the `public` schema is also
-- served by its Data API (PostgREST) to the `anon` and `authenticated` roles,
-- which had SELECT on every table and no row level security - so anyone with
-- the project URL and its public key could have read the data around the app's
-- permission checks.
--
-- 1. Row level security on every table, with no policies: roles other than the
--    owner (and roles with BYPASSRLS) see and change nothing. The owner - the
--    role the app and migrations connect as - is not affected.
-- 2. Revoke the hosted API roles' privileges, now and for tables created later.
-- 3. Pin the search_path of our trigger functions (Supabase advisor 0011).
-- Plain PostgreSQL (local, CI, Docker) has no anon/authenticated roles; those
-- steps are skipped there.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
             AND pg_get_userbyid(p.proowner) = current_user
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;

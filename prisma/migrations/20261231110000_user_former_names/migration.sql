-- AlterTable
ALTER TABLE "users" ADD COLUMN     "former_names" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Keep a short history of display names on every rename, whichever code path
-- renames the user (profile, admin, sign-in providers).
CREATE OR REPLACE FUNCTION users_keep_former_names() RETURNS trigger AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.name IS NOT NULL AND btrim(OLD.name) <> '' THEN
    NEW.former_names := (
      SELECT COALESCE(array_agg(n ORDER BY ord), ARRAY[]::TEXT[])
      FROM (
        SELECT n, ord FROM unnest(array_remove(array_remove(COALESCE(NEW.former_names, ARRAY[]::TEXT[]), OLD.name), NEW.name) || OLD.name) WITH ORDINALITY AS x(n, ord)
        ORDER BY ord DESC
        LIMIT 5
      ) last5
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_keep_former_names
BEFORE UPDATE OF name ON "users"
FOR EACH ROW EXECUTE FUNCTION users_keep_former_names();

-- Renames made before this migration are recoverable from profile / admin audit entries where recorded.

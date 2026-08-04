-- The Pantheon site ID is no longer collected at site creation; sites can be
-- linked to a hosting site later. UNIQUE still holds for non-null values
-- (Postgres allows multiple NULLs under a unique constraint).

ALTER TABLE app.sites ALTER COLUMN pantheon_site_id DROP NOT NULL;

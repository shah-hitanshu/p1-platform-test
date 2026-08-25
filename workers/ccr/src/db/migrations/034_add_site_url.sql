-- Migration 034: Add url column to sites
--
-- Stores the public URL of the site that screenshotting (and future Pantheon
-- integrations) will fetch. Nullable: existing sites have no URL until set.

ALTER TABLE app.sites
  ADD COLUMN url TEXT;

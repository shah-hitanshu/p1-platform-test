-- Soft delete support for sites, branches, and organizations.
-- archived_at IS NULL = active; archived_at IS NOT NULL = soft-deleted.
-- Documents already have this column (migration 008).

ALTER TABLE app.sites
  ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_sites_archived
  ON app.sites(archived_at)
  WHERE archived_at IS NOT NULL;

ALTER TABLE app.branches
  ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_branches_archived
  ON app.branches(archived_at)
  WHERE archived_at IS NOT NULL;

ALTER TABLE app.organizations
  ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_organizations_archived
  ON app.organizations(archived_at)
  WHERE archived_at IS NOT NULL;

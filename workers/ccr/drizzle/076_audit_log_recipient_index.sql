-- Per-org recipient index for the invite quota check.
-- Separated from 072 because CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, and sql.unsafe() wraps multiple statements implicitly.
-- Scoped to (organization_id, lower(target_label)) so the per-recipient cap
-- cannot be burned across tenants.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_org_target_lower_created
    ON app.audit_log (organization_id, lower(target_label), created_at DESC);

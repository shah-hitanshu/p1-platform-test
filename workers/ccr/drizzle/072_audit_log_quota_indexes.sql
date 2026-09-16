-- PCC-3789: indexes for the invite send quota.
--
-- Migration 070 shipped one index and said the rest should arrive with the
-- first read path that wants them. This is that read path: two counts over a
-- short window, per organization and per recipient.
--
-- The recipient index is functional because the quota compares
-- lower(target_label), and a plain btree on target_label cannot serve that.
-- The lower() is defensive rather than strictly required: on the org_user.add
-- path target_label is always written lowercase. It stays because audit_log is
-- a generic table and a future writer need not be so careful.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_org_action_created
    ON app.audit_log (organization_id, action, created_at DESC);

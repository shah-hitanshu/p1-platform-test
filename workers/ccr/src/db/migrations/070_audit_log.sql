-- PCC-3479: audit log
--
-- Records who did what to whom. The immediate need is user management —
-- superadmins reach every business account, so removing someone from an
-- account you were never a member of has to leave a trace — but nothing here
-- is specific to users: `target_type` names the kind of thing acted on, so
-- agents, sites or anything else can be recorded later without a migration.
--
-- Every actor is recorded, not just superadmins. `actor_system_role` is on the
-- row, so "what has Pantheon staff been doing" is a WHERE clause rather than a
-- branch in the write path.
--
-- Two deliberate departures from the rest of the schema:
--
--   No foreign keys. An audit entry is a statement about the past and has to
--   outlive what it describes — DELETE /api/admin/users removes the app.users
--   row outright, and an ON DELETE CASCADE would erase the record of the
--   deletion along with it. `actor_email` and `target_label` are denormalized
--   for the same reason: the row still reads once the ids resolve to nothing.
--
--   target_id is TEXT, not UUID. Everything it points at today is a UUID, but
--   the column exists to be reused, and not every future entity is one.

CREATE TABLE app.audit_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- '<entity>.<verb>', e.g. 'org_user.remove', 'user.update'.
    action            TEXT NOT NULL,
    actor_user_id     UUID,
    actor_email       TEXT,
    actor_system_role TEXT,
    -- NULL for platform-wide actions, which belong to no single account.
    organization_id   UUID,
    target_type       TEXT NOT NULL,
    target_id         TEXT,
    -- Human-readable stand-in for target_id (an email, a name).
    target_label      TEXT,
    -- What changed: the fields the request actually set, and their new values.
    details           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One index, because there is one query. Newest-first is how an audit log is
-- read, and it is the ordering every filtered read will use too. Indexes on
-- actor/target/organization are easy to add alongside the first read path that
-- wants them; guessing now would cost write throughput on an append-only table
-- to serve queries nobody has written.
CREATE INDEX idx_audit_log_created ON app.audit_log(created_at DESC);

COMMENT ON TABLE app.audit_log IS
    'Append-only record of administrative actions. No foreign keys: entries must outlive the rows they describe.';

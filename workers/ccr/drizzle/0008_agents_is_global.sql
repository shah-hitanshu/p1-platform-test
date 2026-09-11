-- Carried from numbered migration 075, which landed on main after the
-- cut-over. Every statement is idempotent: a database that ran 075 as a
-- numbered migration takes each one as a no-op.
--
-- System-provided agents are visible in every organization's roster without
-- per-org seeding.

ALTER TABLE "app"."agents" ADD COLUMN IF NOT EXISTS "is_global" boolean DEFAULT false NOT NULL;

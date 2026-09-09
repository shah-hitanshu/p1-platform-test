-- Migration 075: Global agents
-- Adds is_global flag so system-provided agents (e.g. p1-chatbot) are visible
-- in every organization's agent roster without per-org seeding.

ALTER TABLE app.agents ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT false;

-- No automatic backfill: the system P1 agent was created by hand in each
-- environment, so its name and row id differ. Flag the right row per
-- environment with a one-off UPDATE (see the PR's rollout steps).

-- Migration 021: Site Settings
-- Adds a JSONB settings column to sites for extensible per-site configuration.
-- Initial use: cache TTL overrides for content delivery.

ALTER TABLE app.sites
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- Migration: 031_site_allowed_origins
-- Description: Add allowed_origins column to sites for OAuth redirect URI validation
-- Phase: CSS Auth Server

ALTER TABLE app.sites
  ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN app.sites.allowed_origins IS
  'Allowed origin patterns for OAuth redirect URI validation. '
  'Supports exact matches (https://example.com) and wildcard prefix patterns '
  '(*-mysite.pantheonsite.io) for Pantheon branch URLs.';

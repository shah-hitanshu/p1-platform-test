-- Migration 035: Add site_screenshots table
--
-- One row per site (PRIMARY KEY on site_id) for the current screenshot.
-- Row absent means we've never captured. status is 'ok' or 'failed';
-- on failure, error holds a short reason string.

CREATE TABLE app.site_screenshots (
  site_id      UUID PRIMARY KEY REFERENCES app.sites(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  captured_at  TIMESTAMPTZ NOT NULL,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_screenshots_captured_at
  ON app.site_screenshots(captured_at);

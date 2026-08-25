-- Migration 056: cssuser statement_timeout
--
-- Server-side cap on query runtime for the app role. Postgres only notices a
-- dead client when it tries to send results, so queries abandoned by
-- timed-out workers keep burning CPU to completion — the pile-up that held
-- production at 100% CPU during the 2026-08-19 incident long after the
-- triggering traffic subsided.
--
-- Set on the role, not the instance: Cloud SQL rejects statement_timeout as
-- a database flag (invalidFlagName), and role scope is better anyway — only
-- sessions logging in AS cssuser (the app, via Hyperdrive) inherit it.
-- Migrations log in as the CI IAM user and SET ROLE afterwards, and role
-- GUC defaults apply at login for the login role only, so migrations and
-- admin/proxy sessions are unaffected. Any session needing longer for known
-- work can still raise its own limit with SET statement_timeout.

ALTER ROLE cssuser SET statement_timeout = '30s';

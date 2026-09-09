-- PCC-3816: chat attachments share the store with library assets, marked by `origin`
-- so the listing can exclude them and a sweep can expire them.
--
-- Safe to apply ahead of the Worker deploy: a constant DEFAULT is held in the schema
-- and synthesized on read (O(1), no table rewrite), so existing rows read as
-- 'library', and the deployed Worker names its columns in every SELECT and INSERT.

ALTER TABLE assets ADD COLUMN origin TEXT NOT NULL DEFAULT 'library';

-- Set only for origin='chat'. NULL means "keeps until deleted", which is every
-- library asset and any chat asset promoted out of retention.
ALTER TABLE assets ADD COLUMN expires_at TEXT;

-- For the retention sweep, whose leading filter is origin='chat'. It also tests
-- deleted_at, which this cannot cover — that arm falls back to a scan of the chat rows,
-- a small set next to the library.
CREATE INDEX IF NOT EXISTS idx_assets_expiry ON assets (origin, expires_at);

-- Set once at upload and never cleared. `origin` cannot answer "did this arrive through
-- chat?" after a promote, which moves it to 'library' — and promote is the only route that
-- clears deleted_at. Without a permanent answer, that undelete reaches any deleted library
-- asset, not just the one a conversation is offering to add back.
ALTER TABLE assets ADD COLUMN from_chat INTEGER NOT NULL DEFAULT 0;

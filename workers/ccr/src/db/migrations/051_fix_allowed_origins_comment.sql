-- Migration 051: Correct the allowed_origins column comment (PCC-3531)
--
-- Migration 031 documented the wildcard example as '*-mysite.pantheonsite.io'.
-- That form does not work: utils/cors.ts parseOriginPatterns skips any entry
-- failing /^https?:\/\//, so a protocol-less pattern is silently discarded and
-- the site appears configured while matching nothing. The same wrong form was
-- carried by the admin SPA's input placeholder, so it was actively taught.
--
-- 031 is left as applied history (the runner tracks migrations by name and will
-- not re-run it); this migration updates the comment on databases where 031 has
-- already been applied.
--
-- The write path now rejects invalid patterns outright — see
-- routes/validation.ts validateAllowedOriginPatterns.

COMMENT ON COLUMN app.sites.allowed_origins IS
  'Allowed origin patterns, used for CORS enforcement (see utils/cors.ts) and '
  'intended for OAuth redirect URI validation. Each entry must be an origin '
  'including its protocol and no path: exact (https://example.com) or a single '
  'wildcard in the leftmost label, below a registrable domain '
  '(https://*-mysite.pantheonsite.io), which covers every Pantheon branch URL '
  'for that site. Note: a non-empty list also switches this site from '
  'default-open CORS to allowing only the listed origins.';

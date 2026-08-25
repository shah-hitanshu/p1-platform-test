-- PCC-3457 backfill: normalize raw OAuth-subject principal_ids to UUIDv5.
--
-- The login enrichment path (index.ts:432) stores principal_id as a UUIDv5
-- derived from providerSubToUuid('auth0', sub), but the broker path
-- historically wrote the raw subject string (e.g. 'auth0|pn-abc123').
-- Both production and staging carry a small number of these raw rows.
--
-- The persistence actor resolver (persistence-actor-service.ts) now queries
-- by UUIDv5 only. Without this backfill, raw-format rows are unmatchable
-- and their realtime syncs fail with "unresolvable actor".
--
-- Collision guard: app.users.principal_id is UNIQUE (users_principal_id_key).
-- If the same human already has a second row whose principal_id is the UUIDv5
-- target of a raw row, an unguarded UPDATE would hit a unique violation and
-- abort the whole migration. The UPDATE below therefore SKIPS any raw row
-- whose target UUIDv5 is already claimed by another row, and the trailing
-- DO block RAISE WARNINGs each skipped row so the collision is loud rather
-- than silent. Skipped rows stay raw pending a deliberate identity merge
-- (deciding which users.id survives affects document_versions / user_site_roles
-- attribution — a decision, not a migration).
--
-- UUIDv5 algorithm (RFC 4122 Section 4.3):
--   SHA-1(namespace_bytes || name_bytes), take first 16 bytes,
--   set version=5 (byte 6) and variant=RFC4122 (byte 8).
--
-- Auth0 namespace: 6ba7b811-9dad-51d0-80b4-00c04fd430c8
-- (matches PROVIDER_NAMESPACES['auth0'] in auth/uuid-v5.ts)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH raw_rows AS (
  SELECT id, principal_id
  FROM app.users
  WHERE principal_id IS NOT NULL
    AND principal_id LIKE '%|%'
),
hashed AS (
  SELECT
    id,
    principal_id,
    set_byte(
      set_byte(
        substring(
          digest(
            decode('6ba7b8119dad51d080b400c04fd430c8', 'hex')
            || convert_to(principal_id, 'UTF8'),
            'sha1'
          ) FROM 1 FOR 16
        ),
        6,
        (get_byte(
          substring(
            digest(
              decode('6ba7b8119dad51d080b400c04fd430c8', 'hex')
              || convert_to(principal_id, 'UTF8'),
              'sha1'
            ) FROM 1 FOR 16
          ), 6
        ) & x'0f'::int) | x'50'::int
      ),
      8,
      (get_byte(
        substring(
          digest(
            decode('6ba7b8119dad51d080b400c04fd430c8', 'hex')
            || convert_to(principal_id, 'UTF8'),
            'sha1'
          ) FROM 1 FOR 16
        ), 8
      ) & x'3f'::int) | x'80'::int
    ) AS uuid_bytes
  FROM raw_rows
),
formatted AS (
  SELECT
    id,
    substring(encode(uuid_bytes, 'hex') FROM 1 FOR 8) || '-' ||
    substring(encode(uuid_bytes, 'hex') FROM 9 FOR 4) || '-' ||
    substring(encode(uuid_bytes, 'hex') FROM 13 FOR 4) || '-' ||
    substring(encode(uuid_bytes, 'hex') FROM 17 FOR 4) || '-' ||
    substring(encode(uuid_bytes, 'hex') FROM 21 FOR 12) AS uuid_v5
  FROM hashed
)
UPDATE app.users u
SET principal_id = f.uuid_v5,
    updated_at = NOW()
FROM formatted f
WHERE u.id = f.id
  -- Skip rows whose UUIDv5 target is already held by another user; rewriting
  -- them would violate users_principal_id_key. (The raw row's own principal_id
  -- is the raw subject string, so it can never match f.uuid_v5 here.)
  AND NOT EXISTS (
    SELECT 1
    FROM app.users x
    WHERE x.principal_id = f.uuid_v5
  );

-- Surface any raw-format rows that survived the UPDATE (skipped by the collision
-- guard above). These need a deliberate identity merge — fail loudly, don't
-- pretend the backfill was complete.
DO $$
DECLARE
  leftover RECORD;
  leftover_count INT := 0;
BEGIN
  FOR leftover IN
    SELECT id, principal_id
    FROM app.users
    WHERE principal_id IS NOT NULL
      AND principal_id LIKE '%|%'
  LOOP
    leftover_count := leftover_count + 1;
    RAISE WARNING
      'PCC-3457 backfill: left user % (principal_id=%) unmodified — its UUIDv5 target is already claimed by another row. Resolve with a deliberate identity merge, then re-run.',
      leftover.id, leftover.principal_id;
  END LOOP;

  IF leftover_count > 0 THEN
    RAISE WARNING
      'PCC-3457 backfill: % raw-format principal_id row(s) skipped due to unique-constraint collisions.',
      leftover_count;
  END IF;
END $$;

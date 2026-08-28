-- Backfill: create organizations for existing users who don't have one,
-- and link unlinked sites to their creator's organization.

-- Step 1: Create organizations for users without org membership.
-- Uses a DO block to iterate users individually, avoiding fragile
-- name-based joins between CTEs.
--
-- Naming matches createOrgForUser's runtime dedup (organization-service.ts):
-- the first org to claim a derived base name gets the bare name; each
-- collision after that appends " 2", " 3", etc. Checked against
-- app.organizations directly (not the TS function) since migrations must
-- not depend on application code that can change after this migration runs.
DO $$
DECLARE
    r RECORD;
    new_org_id UUID;
    base_name TEXT;
    derived_name TEXT;
    counter INT;
BEGIN
    FOR r IN
        SELECT u.id AS user_id, u.email
        FROM app.users u
        WHERE NOT EXISTS (
            SELECT 1 FROM app.organization_members om WHERE om.user_id = u.id
        )
        AND u.email IS NOT NULL
        ORDER BY u.created_at
    LOOP
        -- Snapshot of PUBLIC_EMAIL_DOMAINS (workers/src/constants/email-domains.ts)
        -- at the time this migration was written. Not deduped against the TS
        -- constant: migrations are immutable history and must not depend on
        -- application code that can change after this migration has run.
        IF SPLIT_PART(r.email, '@', 2) IN (
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
            'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
            'live.com', 'msn.com', 'me.com', 'mac.com', 'fastmail.com'
        ) THEN
            base_name := SPLIT_PART(r.email, '@', 1);
        ELSE
            base_name := INITCAP(SPLIT_PART(SPLIT_PART(r.email, '@', 2), '.', 1));
        END IF;

        IF NOT EXISTS (SELECT 1 FROM app.organizations WHERE name = base_name) THEN
            derived_name := base_name;
        ELSE
            counter := 2;
            WHILE EXISTS (
                SELECT 1 FROM app.organizations WHERE name = base_name || ' ' || counter::text
            ) LOOP
                counter := counter + 1;
            END LOOP;
            derived_name := base_name || ' ' || counter::text;
        END IF;

        INSERT INTO app.organizations (name, settings)
        VALUES (derived_name, '{"agentIdleTimeoutMs": 5000}'::jsonb)
        RETURNING id INTO new_org_id;

        INSERT INTO app.organization_members (organization_id, user_id)
        VALUES (new_org_id, r.user_id);
    END LOOP;
END
$$;

-- Step 2: Link unlinked sites to their creator's organization.
-- Uses the first user with a role on the site as the "creator".
UPDATE app.sites s
SET organization_id = om.organization_id
FROM (
    SELECT DISTINCT ON (usr.site_id)
        usr.site_id,
        om2.organization_id
    FROM app.user_site_roles usr
    JOIN app.users u ON u.id = usr.user_id::uuid
    JOIN app.organization_members om2 ON om2.user_id = u.id
    ORDER BY usr.site_id, usr.created_at ASC
) om
WHERE s.id = om.site_id
AND s.organization_id IS NULL;

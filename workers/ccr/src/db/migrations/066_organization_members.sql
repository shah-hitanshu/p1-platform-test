-- Business Accounts Phase 1: Organization members + external space linking
--
-- organization_members: tracks which users belong to which org (direct membership)
-- external_space_id: links P1 orgs to PCC spaces for frontend BA merging

CREATE TABLE app.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_user ON app.organization_members(user_id);
CREATE INDEX idx_org_members_org ON app.organization_members(organization_id);

ALTER TABLE app.organizations ADD COLUMN external_space_id TEXT;
CREATE UNIQUE INDEX idx_organizations_external_space ON app.organizations(external_space_id)
    WHERE external_space_id IS NOT NULL;

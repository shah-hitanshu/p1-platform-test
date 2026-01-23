-- Migration 003: Merge Requests
-- Creates merge request and approval request tables
--
-- Based on collaborative-state-system-architecture-v2.2.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Merge Requests Table
-- Tracks branch merge proposals and their status
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES app.sites(id),

    -- Source and target branches
    source_branch_id UUID NOT NULL REFERENCES app.branches(id),
    target_branch_id UUID NOT NULL REFERENCES app.branches(id),

    -- Merge base (checkpoint on target when merge was proposed)
    base_checkpoint_id UUID REFERENCES app.checkpoints(id),

    -- Request metadata
    title TEXT NOT NULL,
    description TEXT,

    -- State
    status TEXT NOT NULL DEFAULT 'open',
    -- Valid statuses: 'open', 'approved', 'merged', 'closed', 'conflicted'

    -- Conflict tracking
    has_conflicts BOOLEAN DEFAULT FALSE,
    conflict_details JSONB,

    -- Authorship
    created_by_id UUID NOT NULL,
    created_by_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Resolution
    merged_at TIMESTAMPTZ,
    merged_by_id UUID,
    merged_by_type TEXT,
    closed_at TIMESTAMPTZ,
    closed_by_id UUID,
    closed_by_type TEXT
);

CREATE INDEX idx_merge_requests_site ON app.merge_requests(site_id);
CREATE INDEX idx_merge_requests_source ON app.merge_requests(source_branch_id);
CREATE INDEX idx_merge_requests_target ON app.merge_requests(target_branch_id);
CREATE INDEX idx_merge_requests_status ON app.merge_requests(site_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Approval Requests Table
-- Tracks merge request approvals (for merge request approvals)
-- NOTE: Candidate for extraction to shared approval service
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE app.approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_request_id UUID NOT NULL REFERENCES app.merge_requests(id) ON DELETE CASCADE,

    -- Approver identity (may not have Pantheon account)
    approver_email TEXT NOT NULL,
    approver_name TEXT,

    -- Auth (for external approvers without Pantheon accounts)
    token_hash TEXT UNIQUE,

    -- State
    status TEXT NOT NULL DEFAULT 'pending',
    -- Valid: 'pending', 'approved', 'rejected', 'expired'

    -- Lifecycle
    expires_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    comment TEXT,

    -- Audit trail
    ip_address TEXT,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(merge_request_id, approver_email)
);

CREATE INDEX idx_approval_requests_mr ON app.approval_requests(merge_request_id);
CREATE INDEX idx_approval_requests_token ON app.approval_requests(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX idx_approval_requests_status ON app.approval_requests(status);

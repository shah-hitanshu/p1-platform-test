CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TABLE "app"."agent_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_api_keys_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."agent_site_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by_id" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."agents" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_organization_id_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "agents_status_check" CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'disabled'::text])),
	CONSTRAINT "agents_id_uuid_format" CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text)
);
--> statement-breakpoint
CREATE TABLE "app"."approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merge_request_id" uuid NOT NULL,
	"approver_email" text NOT NULL,
	"approver_name" text,
	"token_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"comment" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "approval_requests_merge_request_id_approver_email_key" UNIQUE("merge_request_id","approver_email"),
	CONSTRAINT "approval_requests_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."branch_document_metadata" (
	"branch_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conforms_to_schema" boolean DEFAULT true,
	"validation_errors" jsonb DEFAULT '[]'::jsonb,
	"last_modified_at" timestamp with time zone,
	"last_modified_by" uuid,
	CONSTRAINT "branch_document_metadata_pkey" PRIMARY KEY("branch_id","structure_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "app"."branch_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"role" text NOT NULL,
	"granted_by_id" uuid NOT NULL,
	"granted_by_type" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now(),
	"reason" text,
	CONSTRAINT "branch_grants_branch_id_actor_id_key" UNIQUE("branch_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "app"."branch_structure_state" (
	"branch_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"structure_tree" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata_schema" jsonb DEFAULT '{"type":"object","required":["title"],"properties":{"title":{"type":"string","maxLength":100},"description":{"type":"string","maxLength":300}}}'::jsonb NOT NULL,
	"schema_enforcement" text DEFAULT 'warn' NOT NULL,
	"has_changes_since_checkpoint" boolean DEFAULT false,
	"last_modified_at" timestamp with time zone,
	"last_modified_by" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"structure_type" text DEFAULT 'hierarchy' NOT NULL,
	CONSTRAINT "branch_structure_state_pkey" PRIMARY KEY("branch_id","structure_id"),
	CONSTRAINT "unique_branch_slug" UNIQUE("branch_id","slug")
);
--> statement-breakpoint
CREATE TABLE "app"."branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"source_branch_id" uuid,
	"source_checkpoint_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"archived_at" timestamp with time zone,
	CONSTRAINT "branches_site_id_name_key" UNIQUE("site_id","name")
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_document_metadata" (
	"checkpoint_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "checkpoint_document_metadata_pkey" PRIMARY KEY("checkpoint_id","structure_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_documents" (
	"checkpoint_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	CONSTRAINT "checkpoint_documents_pkey" PRIMARY KEY("checkpoint_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoint_structures" (
	"checkpoint_id" uuid NOT NULL,
	"structure_id" uuid NOT NULL,
	"structure_tree" jsonb NOT NULL,
	"metadata_schema" jsonb NOT NULL,
	"schema_enforcement" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"structure_type" text NOT NULL,
	CONSTRAINT "checkpoint_structures_pkey" PRIMARY KEY("checkpoint_id","structure_id")
);
--> statement-breakpoint
CREATE TABLE "app"."checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text,
	"message" text,
	"checkpoint_type" text DEFAULT 'manual' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"description" text,
	"trigger" text DEFAULT 'manual',
	"requested_by_id" uuid,
	"operation_type" text,
	"affected_regions" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'completed',
	"rolled_back_by_id" uuid,
	"rolled_back_at" timestamp with time zone,
	"parent_checkpoint_id" uuid,
	CONSTRAINT "checkpoints_trigger_check" CHECK (trigger = ANY (ARRAY['manual'::text, 'human_requested'::text, 'autonomous'::text])),
	CONSTRAINT "checkpoints_status_check" CHECK (status = ANY (ARRAY['completed'::text, 'rolled_back'::text, 'partial'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."document_relation_branch_sync" (
	"source_document_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"synced_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_relation_branch_sync_pkey" PRIMARY KEY("source_document_id","relation_type","branch_id"),
	CONSTRAINT "document_relation_branch_sync_relation_type_check" CHECK (relation_type = ANY (ARRAY['template'::text, 'localization'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."document_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"target_document_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"synced_version" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "document_relations_source_document_id_relation_type_key" UNIQUE("source_document_id","relation_type"),
	CONSTRAINT "document_relations_relation_type_check" CHECK (relation_type = ANY (ARRAY['template'::text, 'localization'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb,
	"source" text DEFAULT 'edit' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"is_tombstone" boolean DEFAULT false NOT NULL,
	"source_branch_id" uuid,
	"source_version_id" uuid,
	"published_to_version_id" uuid,
	"patch" jsonb,
	"action_type" text,
	"action_metadata" jsonb,
	CONSTRAINT "document_versions_document_id_branch_id_version_number_key" UNIQUE("document_id","branch_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"archived_at" timestamp with time zone,
	"locale" text
);
--> statement-breakpoint
CREATE TABLE "app"."guest_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"message" text,
	"access_count" integer DEFAULT 0,
	"last_access_at" timestamp with time zone,
	CONSTRAINT "guest_links_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."import_id_maps" (
	"import_key" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_id_maps_pkey" PRIMARY KEY("import_key","source_id","entity_type")
);
--> statement-breakpoint
CREATE TABLE "app"."merge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"target_branch_id" uuid NOT NULL,
	"base_checkpoint_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"has_conflicts" boolean DEFAULT false,
	"conflict_details" jsonb,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"merged_at" timestamp with time zone,
	"merged_by_id" uuid,
	"merged_by_type" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_by_type" text
);
--> statement-breakpoint
CREATE TABLE "app"."migration_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_job_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"template_delta" jsonb NOT NULL,
	"document_actions" jsonb NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"prop_conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflict_type" text DEFAULT 'structural' NOT NULL,
	CONSTRAINT "migration_conflicts_resolution_check" CHECK ((resolution IS NULL) OR (resolution = ANY (ARRAY['apply'::text, 'skip'::text, 'manual'::text]))),
	CONSTRAINT "migration_conflicts_conflict_type_check" CHECK (conflict_type = ANY (ARRAY['structural'::text, 'prop'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."migration_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"checkpoint_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"processed_documents" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	CONSTRAINT "migration_jobs_created_by_type_check" CHECK (created_by_type = ANY (ARRAY['user'::text, 'agent'::text, 'system'::text])),
	CONSTRAINT "migration_jobs_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'completed_with_conflicts'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{"agentIdleTimeoutMs":5000}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."site_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY['read:published'] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "site_api_tokens_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."site_screenshots" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"r2_key" text NOT NULL,
	"status" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_screenshots_status_check" CHECK (status = ANY (ARRAY['ok'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."site_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "app"."sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pantheon_site_id" text,
	"name" text NOT NULL,
	"workflow_settings" jsonb DEFAULT '{"approverMode":"both","minApprovers":1,"approverMinRole":"EDITOR","allowSelfApproval":true,"mergeApprovalMode":"optional"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"organization_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"url" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "sites_pantheon_site_id_key" UNIQUE("pantheon_site_id")
);
--> statement-breakpoint
CREATE TABLE "app"."structure_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"parent_node_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"node_type" text DEFAULT 'section' NOT NULL,
	"document_id" uuid,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "structure_nodes_structure_id_parent_node_id_slug_key" UNIQUE("structure_id","parent_node_id","slug")
);
--> statement-breakpoint
CREATE TABLE "app"."user_site_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"site_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_by_id" text,
	"source" text DEFAULT 'local' NOT NULL,
	CONSTRAINT "user_site_roles_user_site_source_key" UNIQUE("user_id","site_id","source")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"principal_id" text,
	"auth_provider" text,
	"system_role" text DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"avatar_url" text,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_principal_id_key" UNIQUE("principal_id")
);
--> statement-breakpoint
ALTER TABLE "app"."agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_site_roles" ADD CONSTRAINT "agent_site_roles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agents" ADD CONSTRAINT "agents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."approval_requests" ADD CONSTRAINT "approval_requests_merge_request_id_fkey" FOREIGN KEY ("merge_request_id") REFERENCES "app"."merge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_document_metadata" ADD CONSTRAINT "branch_document_metadata_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_document_metadata" ADD CONSTRAINT "branch_document_metadata_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "app"."site_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_document_metadata" ADD CONSTRAINT "branch_document_metadata_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_grants" ADD CONSTRAINT "branch_grants_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_structure_state" ADD CONSTRAINT "branch_structure_state_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_structure_state" ADD CONSTRAINT "branch_structure_state_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "app"."site_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branches" ADD CONSTRAINT "branches_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branches" ADD CONSTRAINT "branches_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branches" ADD CONSTRAINT "fk_branches_source_checkpoint" FOREIGN KEY ("source_checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_document_metadata" ADD CONSTRAINT "checkpoint_document_metadata_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_document_metadata" ADD CONSTRAINT "checkpoint_document_metadata_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "app"."site_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_document_metadata" ADD CONSTRAINT "checkpoint_document_metadata_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_documents" ADD CONSTRAINT "checkpoint_documents_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_documents" ADD CONSTRAINT "checkpoint_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_documents" ADD CONSTRAINT "checkpoint_documents_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "app"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_structures" ADD CONSTRAINT "checkpoint_structures_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoint_structures" ADD CONSTRAINT "checkpoint_structures_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "app"."site_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoints" ADD CONSTRAINT "checkpoints_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkpoints" ADD CONSTRAINT "checkpoints_parent_checkpoint_id_fkey" FOREIGN KEY ("parent_checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_relation_branch_sync" ADD CONSTRAINT "document_relation_branch_sync_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_relation_branch_sync" ADD CONSTRAINT "document_relation_branch_sync_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_relations" ADD CONSTRAINT "document_relations_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_relations" ADD CONSTRAINT "document_relations_target_document_id_fkey" FOREIGN KEY ("target_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "app"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_published_to_version_id_fkey" FOREIGN KEY ("published_to_version_id") REFERENCES "app"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."guest_links" ADD CONSTRAINT "guest_links_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_requests" ADD CONSTRAINT "merge_requests_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_requests" ADD CONSTRAINT "merge_requests_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_requests" ADD CONSTRAINT "merge_requests_target_branch_id_fkey" FOREIGN KEY ("target_branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_requests" ADD CONSTRAINT "merge_requests_base_checkpoint_id_fkey" FOREIGN KEY ("base_checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_conflicts" ADD CONSTRAINT "migration_conflicts_migration_job_id_fkey" FOREIGN KEY ("migration_job_id") REFERENCES "app"."migration_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_conflicts" ADD CONSTRAINT "migration_conflicts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_conflicts" ADD CONSTRAINT "migration_conflicts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_conflicts" ADD CONSTRAINT "migration_conflicts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_jobs" ADD CONSTRAINT "migration_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_jobs" ADD CONSTRAINT "migration_jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_jobs" ADD CONSTRAINT "migration_jobs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_jobs" ADD CONSTRAINT "migration_jobs_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "app"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_api_tokens" ADD CONSTRAINT "site_api_tokens_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_screenshots" ADD CONSTRAINT "site_screenshots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."site_structures" ADD CONSTRAINT "site_structures_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sites" ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."structure_nodes" ADD CONSTRAINT "structure_nodes_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "app"."site_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."structure_nodes" ADD CONSTRAINT "structure_nodes_parent_node_id_fkey" FOREIGN KEY ("parent_node_id") REFERENCES "app"."structure_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."structure_nodes" ADD CONSTRAINT "structure_nodes_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_site_roles" ADD CONSTRAINT "user_site_roles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_api_keys_agent_id" ON "app"."agent_api_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_api_keys_hash" ON "app"."agent_api_keys" USING btree ("token_hash") WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_site_roles_active" ON "app"."agent_site_roles" USING btree ("agent_id","site_id") WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_agent_site_roles_agent" ON "app"."agent_site_roles" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_site_roles_agent_id" ON "app"."agent_site_roles" USING btree ("agent_id") WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_agent_site_roles_site" ON "app"."agent_site_roles" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_agent_site_roles_site_id" ON "app"."agent_site_roles" USING btree ("site_id") WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_agents_organization" ON "app"."agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agents_status" ON "app"."agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_mr" ON "app"."approval_requests" USING btree ("merge_request_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_status" ON "app"."approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_token" ON "app"."approval_requests" USING btree ("token_hash") WHERE (token_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_branch_doc_metadata_conformance" ON "app"."branch_document_metadata" USING btree ("branch_id","structure_id","conforms_to_schema");--> statement-breakpoint
CREATE INDEX "idx_branch_doc_metadata_document" ON "app"."branch_document_metadata" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_branch_grants_actor" ON "app"."branch_grants" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_branch_grants_branch" ON "app"."branch_grants" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_branch_structure_state_slug" ON "app"."branch_structure_state" USING btree ("branch_id","slug");--> statement-breakpoint
CREATE INDEX "idx_branches_archived" ON "app"."branches" USING btree ("archived_at") WHERE (archived_at IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_branches_main" ON "app"."branches" USING btree ("site_id") WHERE (is_main = true);--> statement-breakpoint
CREATE INDEX "idx_branches_site" ON "app"."branches" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_branches_status" ON "app"."branches" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "idx_checkpoint_documents_version_id" ON "app"."checkpoint_documents" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "idx_checkpoints_branch" ON "app"."checkpoints" USING btree ("branch_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_checkpoints_parent" ON "app"."checkpoints" USING btree ("parent_checkpoint_id") WHERE (parent_checkpoint_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_document_relations_target" ON "app"."document_relations" USING btree ("target_document_id","synced_version");--> statement-breakpoint
CREATE INDEX "idx_document_versions_source_branch" ON "app"."document_versions" USING btree ("source_branch_id") WHERE (source_branch_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_document_versions_tombstone" ON "app"."document_versions" USING btree ("document_id","branch_id") WHERE (is_tombstone = true);--> statement-breakpoint
CREATE INDEX "idx_versions_branch" ON "app"."document_versions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_versions_doc_branch" ON "app"."document_versions" USING btree ("document_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_site_id_path_active_key" ON "app"."documents" USING btree ("site_id","path") WHERE (archived_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_documents_archived" ON "app"."documents" USING btree ("archived_at") WHERE (archived_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_documents_site" ON "app"."documents" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_guest_links_branch" ON "app"."guest_links" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_guest_links_status" ON "app"."guest_links" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_guest_links_token" ON "app"."guest_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_import_id_maps_key" ON "app"."import_id_maps" USING btree ("import_key");--> statement-breakpoint
CREATE INDEX "idx_merge_requests_site" ON "app"."merge_requests" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_merge_requests_source" ON "app"."merge_requests" USING btree ("source_branch_id");--> statement-breakpoint
CREATE INDEX "idx_merge_requests_status" ON "app"."merge_requests" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "idx_merge_requests_target" ON "app"."merge_requests" USING btree ("target_branch_id");--> statement-breakpoint
CREATE INDEX "idx_migration_conflicts_job" ON "app"."migration_conflicts" USING btree ("migration_job_id");--> statement-breakpoint
CREATE INDEX "idx_migration_conflicts_unresolved" ON "app"."migration_conflicts" USING btree ("branch_id","document_id") WHERE (resolution IS NULL);--> statement-breakpoint
CREATE INDEX "idx_migration_jobs_branch" ON "app"."migration_jobs" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_organizations_archived" ON "app"."organizations" USING btree ("archived_at") WHERE (archived_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_site_api_tokens_hash" ON "app"."site_api_tokens" USING btree ("token_hash") WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_site_api_tokens_site_id" ON "app"."site_api_tokens" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_site_screenshots_captured_at" ON "app"."site_screenshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "idx_site_structures_site" ON "app"."site_structures" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_sites_archived" ON "app"."sites" USING btree ("archived_at") WHERE (archived_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_sites_organization" ON "app"."sites" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_structure_nodes_document" ON "app"."structure_nodes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_structure_nodes_parent" ON "app"."structure_nodes" USING btree ("parent_node_id","position");--> statement-breakpoint
CREATE INDEX "idx_structure_nodes_structure" ON "app"."structure_nodes" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "idx_user_site_roles_site" ON "app"."user_site_roles" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_user_site_roles_source" ON "app"."user_site_roles" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_user_site_roles_updated" ON "app"."user_site_roles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_user_site_roles_user" ON "app"."user_site_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "app"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_principal_id" ON "app"."users" USING btree ("principal_id");
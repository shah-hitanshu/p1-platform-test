CREATE TABLE "app"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"actor_system_role" text,
	"organization_id" uuid,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."merge_job_documents" (
	"job_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_path" text NOT NULL,
	"kind" text NOT NULL,
	"resolution_strategy" text,
	"conflict_type" text,
	"source_version_id" uuid,
	"target_version_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_version_id" uuid,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_job_documents_pkey" PRIMARY KEY("job_id","document_id"),
	CONSTRAINT "merge_job_documents_kind_check" CHECK (kind = ANY (ARRAY['copy'::text, 'conflict'::text])),
	CONSTRAINT "merge_job_documents_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'done'::text, 'skipped_noop'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."merge_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merge_request_id" uuid,
	"site_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"target_branch_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"prior_mr_status" text,
	"resolution_strategy" text,
	"resolutions" jsonb,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"processed_documents" integer DEFAULT 0 NOT NULL,
	"failed_documents" integer DEFAULT 0 NOT NULL,
	"noop_documents" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"post_merge_checkpoint_id" uuid,
	"publish_checkpoint_id" uuid,
	"publish_error" text,
	"error" text,
	"triggered_by_id" uuid NOT NULL,
	"triggered_by_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "merge_jobs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text, 'completed'::text, 'completed_with_errors'::text, 'blocked_on_conflicts'::text, 'failed'::text, 'cancelled'::text])),
	CONSTRAINT "merge_jobs_triggered_by_type_check" CHECK (triggered_by_type = ANY (ARRAY['user'::text, 'agent'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_members_role_check" CHECK (role = ANY (ARRAY['member'::text, 'admin'::text, 'owner'::text]))
);
--> statement-breakpoint
ALTER TABLE "app"."document_versions" DROP CONSTRAINT "document_versions_source_version_id_fkey";
--> statement-breakpoint
ALTER TABLE "app"."checkpoints" ADD COLUMN "is_full_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."organizations" ADD COLUMN "external_space_id" text;--> statement-breakpoint
ALTER TABLE "app"."merge_job_documents" ADD CONSTRAINT "merge_job_documents_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "app"."merge_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_job_documents" ADD CONSTRAINT "merge_job_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_jobs" ADD CONSTRAINT "merge_jobs_merge_request_id_fkey" FOREIGN KEY ("merge_request_id") REFERENCES "app"."merge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_jobs" ADD CONSTRAINT "merge_jobs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_jobs" ADD CONSTRAINT "merge_jobs_source_branch_id_fkey" FOREIGN KEY ("source_branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."merge_jobs" ADD CONSTRAINT "merge_jobs_target_branch_id_fkey" FOREIGN KEY ("target_branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_created" ON "app"."audit_log" USING btree ("created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "merge_job_documents_pending_idx" ON "app"."merge_job_documents" USING btree ("job_id") WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "merge_job_documents_document_id_idx" ON "app"."merge_job_documents" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_jobs_active_per_mr" ON "app"."merge_jobs" USING btree ("merge_request_id") WHERE ((merge_request_id IS NOT NULL) AND (status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text])));--> statement-breakpoint
CREATE UNIQUE INDEX "merge_jobs_active_per_branch_pair" ON "app"."merge_jobs" USING btree ("site_id","source_branch_id","target_branch_id") WHERE ((merge_request_id IS NULL) AND (status = ANY (ARRAY['queued'::text, 'planning'::text, 'running'::text, 'finalizing'::text])));--> statement-breakpoint
CREATE INDEX "merge_jobs_merge_request_id_idx" ON "app"."merge_jobs" USING btree ("merge_request_id") WHERE (merge_request_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_org_members_org" ON "app"."organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_org_admin" ON "app"."organization_members" USING btree ("organization_id") WHERE (role = ANY (ARRAY['admin'::text, 'owner'::text]));--> statement-breakpoint
CREATE INDEX "idx_org_members_user" ON "app"."organization_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD CONSTRAINT "document_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "app"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_external_space" ON "app"."organizations" USING btree ("external_space_id") WHERE (external_space_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_system_role_check" CHECK (system_role = ANY (ARRAY['member'::text, 'admin'::text, 'superadmin'::text]));
CREATE TABLE "app"."branch_document_paths" (
	"branch_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_document_paths_pkey" PRIMARY KEY("branch_id","document_id"),
	CONSTRAINT "branch_document_paths_branch_id_path_key" UNIQUE("branch_id","path")
);
--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."document_versions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."branch_document_paths" ADD CONSTRAINT "branch_document_paths_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."branch_document_paths" ADD CONSTRAINT "branch_document_paths_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_checkpoint_documents_document" ON "app"."checkpoint_documents" USING btree ("document_id","checkpoint_id");--> statement-breakpoint
CREATE INDEX "idx_checkpoints_branch_type_created" ON "app"."checkpoints" USING btree ("branch_id","checkpoint_type","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_versions_live_on_branch" ON "app"."document_versions" USING btree ("branch_id","document_id","version_number" DESC NULLS FIRST) WHERE (superseded_at IS NULL);
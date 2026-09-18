CREATE TABLE "app"."comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"context_id" text NOT NULL,
	"document_id" uuid,
	"branch_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_type" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_type" text,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_threads_context_type_check" CHECK (context_type = ANY (ARRAY['block'::text, 'page'::text, 'site'::text, 'workstream'::text])),
	CONSTRAINT "comment_threads_status_check" CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text])),
	CONSTRAINT "comment_threads_created_by_type_check" CHECK (created_by_type = ANY (ARRAY['user'::text, 'agent'::text]))
);
--> statement-breakpoint
CREATE TABLE "app"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb,
	"author_type" text NOT NULL,
	"author_id" uuid NOT NULL,
	"acting_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_kind_check" CHECK (kind = ANY (ARRAY['message'::text])),
	CONSTRAINT "comments_author_type_check" CHECK (author_type = ANY (ARRAY['user'::text, 'agent'::text]))
);
--> statement-breakpoint
ALTER TABLE "app"."comment_threads" ADD CONSTRAINT "comment_threads_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "app"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."comment_threads" ADD CONSTRAINT "comment_threads_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."comment_threads" ADD CONSTRAINT "comment_threads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."comments" ADD CONSTRAINT "comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "app"."comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_threads_open_context_key" ON "app"."comment_threads" USING btree ("site_id","context_type","context_id") WHERE (status = 'open');--> statement-breakpoint
CREATE INDEX "idx_comment_threads_context" ON "app"."comment_threads" USING btree ("site_id","context_type","context_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_comment_threads_document" ON "app"."comment_threads" USING btree ("site_id","document_id");--> statement-breakpoint
CREATE INDEX "idx_comment_threads_site_updated" ON "app"."comment_threads" USING btree ("site_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_comments_thread_created" ON "app"."comments" USING btree ("thread_id","created_at");
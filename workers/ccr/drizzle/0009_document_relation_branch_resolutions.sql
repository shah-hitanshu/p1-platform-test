-- Carried from numbered migration 074, which landed on main after the
-- cut-over. Every statement is idempotent: a database that ran 074 as a
-- numbered migration takes each one as a no-op.
--
-- Records which reported changes a derived document has reconciled, per branch,
-- so reconciling on one branch leaves the others reporting what they would have.
--
-- A resolution holds a fingerprint of the upstream value the change was settled
-- against rather than the version it was read from: version numbers count up per
-- (document, branch), while a fingerprint identifies the value itself and so means
-- the same thing read from any branch. A change stays settled while the upstream
-- still holds that value.

CREATE TABLE IF NOT EXISTS "app"."document_relation_branch_resolutions" (
	"source_document_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"resolutions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inherited" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_relation_branch_resolutions_pkey" PRIMARY KEY("source_document_id","relation_type","branch_id"),
	CONSTRAINT "document_relation_branch_resolutions_relation_type_check" CHECK (relation_type = ANY (ARRAY['template'::text, 'localization'::text]))
);--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "app"."document_relation_branch_resolutions" ADD CONSTRAINT "document_relation_branch_resolutions_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "app"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "app"."document_relation_branch_resolutions" ADD CONSTRAINT "document_relation_branch_resolutions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "app"."branches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

COMMENT ON TABLE app.document_relation_branch_resolutions IS
  'Per-branch record of which of a derived document''s reported upstream changes have been reconciled.';
--> statement-breakpoint

COMMENT ON COLUMN app.document_relation_branch_resolutions.resolutions IS
  'Nested {slotId: {propPath: {hash, at}}}; hash fingerprints the upstream value settled against, at is when.';
--> statement-breakpoint

COMMENT ON COLUMN app.document_relation_branch_resolutions.inherited IS
  'Main''s resolutions when this row was created: its own map started as this, plus or minus the write that created the row. Empty on main''s own row and where the ceiling left that write standing alone. Written once on insert and never updated.';

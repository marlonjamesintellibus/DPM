CREATE TABLE "commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"capture_id" text,
	"extraction_id" text,
	"what" text NOT NULL,
	"due_on" date NOT NULL,
	"link_type" text,
	"link_id" text,
	"link_project_id" text,
	"state" text NOT NULL,
	"moves" integer DEFAULT 0 NOT NULL,
	"check_ins" integer DEFAULT 0 NOT NULL,
	"check_in_out" boolean DEFAULT false NOT NULL,
	"check_in_on" date,
	"stands" text,
	"saved_on" date NOT NULL,
	"ended_on" date,
	"ended_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_link_project_id_projects_id_fk" FOREIGN KEY ("link_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_owner_state" ON "commitments" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "commitments_link" ON "commitments" USING btree ("link_id");
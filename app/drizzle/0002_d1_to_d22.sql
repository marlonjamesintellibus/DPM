CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"project_id" text
);
--> statement-breakpoint
ALTER TABLE "braid_entries" ADD COLUMN "kept_on_merge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "braid_sources" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "failed_step" text;--> statement-breakpoint
ALTER TABLE "leave" ADD COLUMN "change_start" date;--> statement-breakpoint
ALTER TABLE "leave" ADD COLUMN "change_end" date;--> statement-breakpoint
ALTER TABLE "leave" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "decision_approvers" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_person" ON "notices" USING btree ("person_id","at");--> statement-breakpoint
ALTER TABLE "leave" ADD CONSTRAINT "leave_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
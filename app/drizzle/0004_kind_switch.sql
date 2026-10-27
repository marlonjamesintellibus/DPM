CREATE TABLE "braid_kind_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"state" text NOT NULL,
	"asked_by" text,
	"to_kind" text NOT NULL,
	"why" text NOT NULL,
	"asked_on" date,
	"answered_by" text,
	"answered_on" date,
	"keep_reason" text,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminded_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "braid_entries" ADD COLUMN "switched_by" text;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD COLUMN "switched_on" date;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD COLUMN "switch_reason" text;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD COLUMN "state_before_switch" text;--> statement-breakpoint
ALTER TABLE "braid_kind_requests" ADD CONSTRAINT "braid_kind_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_kind_requests" ADD CONSTRAINT "braid_kind_requests_entry_id_braid_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_kind_requests" ADD CONSTRAINT "braid_kind_requests_asked_by_people_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_kind_requests" ADD CONSTRAINT "braid_kind_requests_answered_by_people_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "braid_kind_requests_entry" ON "braid_kind_requests" USING btree ("entry_id","state");--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_switched_by_people_id_fk" FOREIGN KEY ("switched_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
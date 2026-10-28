CREATE TABLE "attributed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"recorder_id" text NOT NULL,
	"person_id" text,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"draft" jsonb NOT NULL,
	"quote" text NOT NULL,
	"state" text NOT NULL,
	"wording" text,
	"due_on" date,
	"asked_on" date,
	"decided_on" date,
	"reason" text,
	"also_from" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"recorder_id" text NOT NULL,
	"project_id" text NOT NULL,
	"attendees" text[] DEFAULT '{}'::text[] NOT NULL,
	"mode" text,
	"merged_with" text,
	"state" text NOT NULL,
	"received_on" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_capture_id_unique" UNIQUE("capture_id")
);
--> statement-breakpoint
ALTER TABLE "attributed_items" ADD CONSTRAINT "attributed_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributed_items" ADD CONSTRAINT "attributed_items_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributed_items" ADD CONSTRAINT "attributed_items_recorder_id_people_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributed_items" ADD CONSTRAINT "attributed_items_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributed_items" ADD CONSTRAINT "attributed_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_recorder_id_people_id_fk" FOREIGN KEY ("recorder_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attributed_items_person" ON "attributed_items" USING btree ("person_id","state");--> statement-breakpoint
CREATE INDEX "attributed_items_meeting" ON "attributed_items" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_project" ON "meetings" USING btree ("project_id","state");
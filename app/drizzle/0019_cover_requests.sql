CREATE TABLE "cover_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"leave_id" text NOT NULL,
	"asker_id" text NOT NULL,
	"capture_id" text,
	"project_id" text,
	"to_id" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"declined" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text NOT NULL,
	"handover" text DEFAULT 'none' NOT NULL,
	"handover_id" text,
	"ended_why" text,
	"asked_at" timestamp with time zone,
	"ask_command_id" text,
	"answer_command_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_leave_id_leave_id_fk" FOREIGN KEY ("leave_id") REFERENCES "public"."leave"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_asker_id_people_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_to_id_people_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cover_requests" ADD CONSTRAINT "cover_requests_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cover_requests_leave_state" ON "cover_requests" USING btree ("leave_id","state");--> statement-breakpoint
CREATE INDEX "cover_requests_to_state" ON "cover_requests" USING btree ("to_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "cover_requests_ask_command" ON "cover_requests" USING btree ("ask_command_id");
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"project_id" text,
	"capture_id" text NOT NULL,
	"state" text NOT NULL,
	"attempt" integer NOT NULL,
	"attempt_at" timestamp with time zone,
	"facts" jsonb NOT NULL,
	"text" text,
	"by" text,
	"edited" boolean DEFAULT false NOT NULL,
	"aside" text,
	"ready_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_capture_id_unique" UNIQUE("capture_id")
);
--> statement-breakpoint
ALTER TABLE "status_reasons" ADD COLUMN "client_shareable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_open" ON "drafts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "drafts_owner" ON "drafts" USING btree ("owner_id","kind","state");
CREATE TABLE "owner_asks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"extraction_id" text NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_field" text,
	"owner_id" text,
	"saw" text,
	"value" text NOT NULL,
	"title" text,
	"state" text NOT NULL,
	"asked_on" date NOT NULL,
	"decided_by" text,
	"decided_on" date,
	"reason" text,
	"applied_value" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_asks" ADD CONSTRAINT "owner_asks_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_asks_project_state" ON "owner_asks" USING btree ("project_id","state");
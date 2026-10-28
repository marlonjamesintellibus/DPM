CREATE TABLE "standups" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"day" date NOT NULL,
	"conversation_id" text,
	"started_by" text,
	"state" text NOT NULL,
	"steps" jsonb NOT NULL,
	"current" jsonb,
	"asked_at" timestamp with time zone,
	"shown_in" text,
	"ended_by" text,
	"capture_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_started_by_captures_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_shown_in_captures_id_fk" FOREIGN KEY ("shown_in") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standups" ADD CONSTRAINT "standups_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standups_person_day" ON "standups" USING btree ("person_id","day");--> statement-breakpoint
CREATE INDEX "standups_open" ON "standups" USING btree ("state","conversation_id");--> statement-breakpoint
CREATE INDEX "standups_capture" ON "standups" USING btree ("capture_id");
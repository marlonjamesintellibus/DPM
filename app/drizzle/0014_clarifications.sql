CREATE TABLE "clarifications" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"author_id" text NOT NULL,
	"conversation_id" text,
	"about" text NOT NULL,
	"extraction_id" text,
	"answer_capture_id" text,
	"act" text,
	"reason" text,
	"quote" text NOT NULL,
	"options" jsonb NOT NULL,
	"state" text NOT NULL,
	"chosen" text,
	"answered_by" text,
	"ended_by" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clarifications_capture_id_unique" UNIQUE("capture_id")
);
--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_extraction_id_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_answer_capture_id_captures_id_fk" FOREIGN KEY ("answer_capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_answered_by_captures_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clarifications_open" ON "clarifications" USING btree ("state","conversation_id");--> statement-breakpoint
CREATE INDEX "clarifications_answered_by" ON "clarifications" USING btree ("answered_by");
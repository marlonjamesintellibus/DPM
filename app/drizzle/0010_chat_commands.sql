CREATE TABLE "chat_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"asker_id" text NOT NULL,
	"via" text NOT NULL,
	"capture_id" text NOT NULL,
	"answer_capture_id" text NOT NULL,
	"line" integer NOT NULL,
	"act" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"project_id" text NOT NULL,
	"proposal" text,
	"outcome" text,
	"about" jsonb NOT NULL,
	"seen_version" integer NOT NULL,
	"input" jsonb,
	"state" text NOT NULL,
	"refused_why" text,
	"refusal" text,
	"decided_at" timestamp with time zone,
	"dedup_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_commands_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "command_note" text;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_asker_id_people_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_answer_capture_id_captures_id_fk" FOREIGN KEY ("answer_capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_commands" ADD CONSTRAINT "chat_commands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_commands_answer" ON "chat_commands" USING btree ("answer_capture_id");--> statement-breakpoint
CREATE INDEX "chat_commands_capture" ON "chat_commands" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "chat_commands_open" ON "chat_commands" USING btree ("state");
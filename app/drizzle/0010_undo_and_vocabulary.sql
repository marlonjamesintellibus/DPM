CREATE TABLE "undos" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"state" text NOT NULL,
	"refusal" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"word" text,
	"person_id" text,
	"tie" text,
	"remove" boolean DEFAULT false NOT NULL,
	"proposed_by" text,
	"for_id" text NOT NULL,
	"capture_id" text,
	"dedup_key" text NOT NULL,
	"state" text NOT NULL,
	"proposed_on" date NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminded_on" date,
	"decided_by" text,
	"decided_on" date,
	"clashes_with" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_changes_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "undos" ADD CONSTRAINT "undos_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "undos" ADD CONSTRAINT "undos_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_proposed_by_people_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_for_id_people_id_fk" FOREIGN KEY ("for_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_changes" ADD CONSTRAINT "vocabulary_changes_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "undos_capture" ON "undos" USING btree ("capture_id");--> statement-breakpoint
CREATE INDEX "vocabulary_changes_project" ON "vocabulary_changes" USING btree ("project_id","state");
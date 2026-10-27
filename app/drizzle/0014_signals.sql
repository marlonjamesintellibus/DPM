CREATE TABLE "signal_memory" (
	"project_id" text NOT NULL,
	"rule" text NOT NULL,
	"subject_id" text NOT NULL,
	"episode" text NOT NULL,
	"level" integer NOT NULL,
	"answer" text NOT NULL,
	"by" text,
	"on" date NOT NULL,
	"reason" text,
	"seen_gone" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_memory_project_id_rule_subject_id_pk" PRIMARY KEY("project_id","rule","subject_id")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"rule" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"state" text NOT NULL,
	"stage" text NOT NULL,
	"level" integer NOT NULL,
	"episode" text NOT NULL,
	"facts" jsonb NOT NULL,
	"raised_on" date NOT NULL,
	"stage_on" date NOT NULL,
	"decided_by" text,
	"decided_on" date,
	"dismiss_reason" text,
	"risk_entry_id" text,
	"earlier" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "braid_sources" ADD COLUMN "signal_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_memory" ADD CONSTRAINT "signal_memory_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_memory" ADD CONSTRAINT "signal_memory_by_people_id_fk" FOREIGN KEY ("by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_risk_entry_id_braid_entries_id_fk" FOREIGN KEY ("risk_entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signals_project" ON "signals" USING btree ("project_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_live" ON "signals" USING btree ("project_id","rule","subject_id") WHERE "signals"."state" in ('raised', 'dismissed');
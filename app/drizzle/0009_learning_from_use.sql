CREATE TABLE "answer_feedback" (
	"capture_id" text NOT NULL,
	"person_id" text NOT NULL,
	"rating" text NOT NULL,
	"wrong" text,
	"topic" text NOT NULL,
	"answer_as_of" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_feedback_capture_id_person_id_pk" PRIMARY KEY("capture_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "eval_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"cause" text NOT NULL,
	"capture_id" text NOT NULL,
	"extraction_id" text,
	"dedup_key" text NOT NULL,
	"state" text NOT NULL,
	"text" text,
	"detail" jsonb,
	"logged_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"case_text" text,
	"expected" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "help_improve_atlas" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_candidates" ADD CONSTRAINT "eval_candidates_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_candidates" ADD CONSTRAINT "eval_candidates_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_candidates_person" ON "eval_candidates" USING btree ("person_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_candidates_dedup_live" ON "eval_candidates" USING btree ("dedup_key") WHERE "eval_candidates"."state" <> 'deleted';
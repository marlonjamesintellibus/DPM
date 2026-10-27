CREATE TABLE "audit_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"machine" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"capture_id" text,
	"extraction_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "braid_answers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"by" text NOT NULL,
	"act" text NOT NULL,
	"note" text,
	"round" integer NOT NULL,
	"on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "braid_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"owner_id" text,
	"reported_by" text,
	"round" integer DEFAULT 1 NOT NULL,
	"proposed_on" date,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminded_on" date,
	"decided_by" text,
	"decided_on" date,
	"self_approved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"resolved_on" date,
	"resolve_proposed_by" text,
	"new_alert" boolean DEFAULT false NOT NULL,
	"merged_into" text,
	"state_before_merge" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "braid_links" (
	"entry_id" text NOT NULL,
	"other_entry_id" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "braid_links_entry_id_other_entry_id_relation_pk" PRIMARY KEY("entry_id","other_entry_id","relation")
);
--> statement-breakpoint
CREATE TABLE "braid_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"origin_entry_id" text NOT NULL,
	"person_id" text NOT NULL,
	"capture_id" text,
	"extraction_id" text,
	"span_start" integer,
	"span_end" integer,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"duration_seconds" integer,
	"message_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"dedup_key" text NOT NULL,
	"state" text NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"proposals" integer DEFAULT 0 NOT NULL,
	"more_found" boolean DEFAULT false NOT NULL,
	"reminded" boolean DEFAULT false NOT NULL,
	"transcript_confidence" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captures_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"project_id" text,
	"routing" text NOT NULL,
	"draft" jsonb NOT NULL,
	"state" text NOT NULL,
	"confidence" text NOT NULL,
	"value" text,
	"saw" text,
	"conflict" jsonb,
	"withdrawn" text,
	"touched" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" text NOT NULL,
	"person_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_person_id_pk" PRIMARY KEY("group_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"connected_to_dpm" boolean DEFAULT false NOT NULL,
	"atlas_group_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"handover_id" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handovers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"from_person_id" text NOT NULL,
	"to_person_id" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"cause_key" text NOT NULL,
	"episode" integer NOT NULL,
	"state" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"state" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"state" text NOT NULL,
	"target_date" date NOT NULL,
	"forecast_date" date,
	"client_visible" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"title" text,
	"org_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_contacts" (
	"project_id" text NOT NULL,
	"person_id" text NOT NULL,
	"tie" text NOT NULL,
	CONSTRAINT "project_contacts_project_id_person_id_pk" PRIMARY KEY("project_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"project_id" text NOT NULL,
	"person_id" text NOT NULL,
	"state" text NOT NULL,
	"role" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_memberships_project_id_person_id_pk" PRIMARY KEY("project_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"customer" text,
	"owner_id" text NOT NULL,
	"contract_type" text,
	"start_date" date,
	"end_date" date,
	"set_override" text DEFAULT 'calculated_only' NOT NULL,
	"set_status" text,
	"reason_given_at" text,
	"set_by" text,
	"set_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "status_reason_links" (
	"reason_id" text NOT NULL,
	"braid_entry_id" text NOT NULL,
	CONSTRAINT "status_reason_links_reason_id_braid_entry_id_pk" PRIMARY KEY("reason_id","braid_entry_id")
);
--> statement-breakpoint
CREATE TABLE "status_reasons" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"text" text NOT NULL,
	"drafted_by_atlas" boolean DEFAULT false NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"saved_by" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"stale_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text,
	"milestone_id" text,
	"number" text,
	"title" text NOT NULL,
	"owner_id" text NOT NULL,
	"state" text NOT NULL,
	"due_date" date,
	"blocked_note" text,
	"blocked_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "braid_answers" ADD CONSTRAINT "braid_answers_entry_id_braid_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_answers" ADD CONSTRAINT "braid_answers_by_people_id_fk" FOREIGN KEY ("by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_reported_by_people_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_resolved_by_people_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_entries" ADD CONSTRAINT "braid_entries_resolve_proposed_by_people_id_fk" FOREIGN KEY ("resolve_proposed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_links" ADD CONSTRAINT "braid_links_entry_id_braid_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_links" ADD CONSTRAINT "braid_links_other_entry_id_braid_entries_id_fk" FOREIGN KEY ("other_entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_sources" ADD CONSTRAINT "braid_sources_entry_id_braid_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_sources" ADD CONSTRAINT "braid_sources_origin_entry_id_braid_entries_id_fk" FOREIGN KEY ("origin_entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_sources" ADD CONSTRAINT "braid_sources_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "braid_sources" ADD CONSTRAINT "braid_sources_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_steps" ADD CONSTRAINT "handover_steps_handover_id_handovers_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handovers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_from_person_id_people_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave" ADD CONSTRAINT "leave_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_set_by_people_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reason_links" ADD CONSTRAINT "status_reason_links_reason_id_status_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."status_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reason_links" ADD CONSTRAINT "status_reason_links_braid_entry_id_braid_entries_id_fk" FOREIGN KEY ("braid_entry_id") REFERENCES "public"."braid_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reasons" ADD CONSTRAINT "status_reasons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reasons" ADD CONSTRAINT "status_reasons_saved_by_people_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit_entries" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "braid_entries_project" ON "braid_entries" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "braid_sources_entry" ON "braid_sources" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractions_capture_ordinal" ON "extractions" USING btree ("capture_id","ordinal");--> statement-breakpoint
CREATE INDEX "extractions_project" ON "extractions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_owner_cause_episode" ON "inbox_items" USING btree ("owner_id","cause_key","episode");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_project_number" ON "work_items" USING btree ("project_id","number");
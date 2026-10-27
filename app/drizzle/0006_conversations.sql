CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"state" text NOT NULL,
	"title" text NOT NULL,
	"title_by" text DEFAULT 'auto' NOT NULL,
	"channel" text NOT NULL,
	"atlas_chat_id" text,
	"last_message_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captures" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner" ON "conversations" USING btree ("owner_id","state","last_message_at");--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- CV15: messages from before conversations existed. Atlas app messages share their author's Atlas conversation
INSERT INTO "conversations" ("id", "owner_id", "state", "title", "title_by", "channel", "atlas_chat_id", "last_message_at")
SELECT 'conv-atlas-' || "author_id", "author_id", 'active', 'Atlas', 'auto', 'atlas', 'dm', max("message_at")
FROM "captures" WHERE "channel" = 'atlas' AND "conversation_id" IS NULL GROUP BY "author_id";--> statement-breakpoint
UPDATE "captures" SET "conversation_id" = 'conv-atlas-' || "author_id" WHERE "channel" = 'atlas' AND "conversation_id" IS NULL;--> statement-breakpoint
-- ...and each app message is its own conversation, titled from its words
INSERT INTO "conversations" ("id", "owner_id", "state", "title", "title_by", "channel", "atlas_chat_id", "last_message_at")
SELECT 'conv-' || "id", "author_id", 'active', CASE WHEN length(btrim("text")) = 0 THEN 'New conversation' WHEN length(btrim("text")) <= 60 THEN btrim("text") ELSE left(btrim("text"), 60) || '…' END, 'auto', 'app', NULL, "message_at"
FROM "captures" WHERE "channel" = 'app' AND "conversation_id" IS NULL;--> statement-breakpoint
UPDATE "captures" SET "conversation_id" = 'conv-' || "id" WHERE "channel" = 'app' AND "conversation_id" IS NULL;

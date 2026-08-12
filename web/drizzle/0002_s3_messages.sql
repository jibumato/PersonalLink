CREATE TYPE "public"."message_kind" AS ENUM('text', 'image', 'file', 'system');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retracted_at" timestamp with time zone,
	"deleted_by" uuid[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "messages_retracted_has_no_body" CHECK ("messages"."retracted_at" is null or "messages"."body" is null),
	CONSTRAINT "messages_system_has_no_sender" CHECK (("messages"."kind" = 'system') = ("messages"."sender_id" is null)),
	CONSTRAINT "messages_system_not_muted" CHECK ("messages"."kind" <> 'system' or "messages"."muted" = false)
);
--> statement-breakpoint
ALTER TABLE "connection_members" ADD COLUMN "last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_connection_idx" ON "messages" USING btree ("connection_id","created_at");
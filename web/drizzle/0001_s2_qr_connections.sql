CREATE TYPE "public"."connection_status" AS ENUM('active', 'grace', 'permanent', 'expired');--> statement-breakpoint
CREATE TABLE "connection_members" (
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "connection_members_connection_id_user_id_pk" PRIMARY KEY("connection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"pair_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"established_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "connections_permanent_has_no_expiry" CHECK (("connections"."status" = 'permanent') = ("connections"."expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expiry_days" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by" uuid,
	CONSTRAINT "qr_tokens_expiry_days" CHECK ("qr_tokens"."expiry_days" in (1, 7, 30))
);
--> statement-breakpoint
ALTER TABLE "connection_members" ADD CONSTRAINT "connection_members_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_members" ADD CONSTRAINT "connection_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_consumed_by_users_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_members_user_idx" ON "connection_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_alive_pair_unique" ON "connections" USING btree ("pair_key") WHERE "connections"."status" <> 'expired';--> statement-breakpoint
CREATE INDEX "connections_expires_idx" ON "connections" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "qr_tokens_user_idx" ON "qr_tokens" USING btree ("user_id");
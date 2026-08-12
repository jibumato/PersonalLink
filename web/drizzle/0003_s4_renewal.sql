CREATE TYPE "public"."renewal_choice" AS ENUM('continue', 'end');--> statement-breakpoint
CREATE TABLE "renewal_choices" (
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"choice" "renewal_choice" NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_choices_connection_id_user_id_pk" PRIMARY KEY("connection_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "renewal_choices" ADD CONSTRAINT "renewal_choices_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_choices" ADD CONSTRAINT "renewal_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
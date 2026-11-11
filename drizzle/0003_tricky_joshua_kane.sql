CREATE TABLE "partner_markups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(16) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"markup_bps" integer NOT NULL,
	"fee_inr" integer NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" varchar(120) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" varchar(12) DEFAULT 'parsed' NOT NULL,
	"note" text,
	"text" text,
	"image_data_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"title" text DEFAULT 'My travel plan' NOT NULL,
	"status" varchar(16) DEFAULT 'uploading' NOT NULL,
	"extracted" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "itinerary_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source" varchar(12) DEFAULT 'catalogue' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_files" ADD CONSTRAINT "plan_files_plan_id_travel_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."travel_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_markup_uq" ON "partner_markups" USING btree ("platform","kind");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_plan_id_travel_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."travel_plans"("id") ON DELETE no action ON UPDATE no action;
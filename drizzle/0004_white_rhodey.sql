CREATE TABLE "mock_hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_key" varchar(40) NOT NULL,
	"city_name" text NOT NULL,
	"name" text NOT NULL,
	"stars" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"address" text NOT NULL,
	"nightly_base_inr" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mock_hotels_area_idx" ON "mock_hotels" USING btree ("area_key");
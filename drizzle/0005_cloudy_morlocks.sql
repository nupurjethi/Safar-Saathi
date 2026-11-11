CREATE TABLE "map_tiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"bbox" jsonb NOT NULL,
	"max_zoom" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_tiles_key_unique" UNIQUE("key")
);

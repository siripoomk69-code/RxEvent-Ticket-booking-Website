CREATE TABLE "documents" (
	"collection" text,
	"id" text,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_pkey" PRIMARY KEY("collection","id")
);
--> statement-breakpoint
CREATE TABLE "locks" (
	"name" text PRIMARY KEY,
	"holder" text NOT NULL,
	"expires_at" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "model_models" (
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"input_modalities" jsonb DEFAULT '["text"]'::jsonb NOT NULL,
	"output_modalities" jsonb DEFAULT '["text"]'::jsonb NOT NULL,
	"context_window" integer,
	"max_tokens" integer,
	"source" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_models_pkey" PRIMARY KEY("provider_id","model_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api" text NOT NULL,
	"auth_header" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_ref" text,
	"encrypted_api_key" text,
	"key_fingerprint" text,
	"models_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_usage_bindings" (
	"usage_id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_models" ADD CONSTRAINT "model_models_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_usage_bindings" ADD CONSTRAINT "model_usage_bindings_provider_id_model_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_providers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_usage_bindings" ADD CONSTRAINT "model_usage_bindings_provider_model_fk" FOREIGN KEY ("provider_id","model_id") REFERENCES "public"."model_models"("provider_id","model_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_bindings_provider_model_idx" ON "model_usage_bindings" USING btree ("provider_id","model_id");
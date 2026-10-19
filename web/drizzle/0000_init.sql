CREATE TYPE "public"."cabin" AS ENUM('economy', 'premium-economy', 'business', 'first');--> statement-breakpoint
CREATE TYPE "public"."date_mode" AS ENUM('fixed', 'window', 'rolling');--> statement-breakpoint
CREATE TYPE "public"."trip_type" AS ENUM('one_way', 'round_trip');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"run_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"best_price" numeric(10, 2) NOT NULL,
	"depart_date" date NOT NULL,
	"return_date" date,
	"email_to" text NOT NULL,
	"provider_id" text
);
--> statement-breakpoint
CREATE TABLE "price_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"route_id" integer NOT NULL,
	"run_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"depart_date" date NOT NULL,
	"return_date" date,
	"price" numeric(10, 2) NOT NULL,
	"currency" text NOT NULL,
	"airlines" text[] NOT NULL,
	"stops" integer NOT NULL,
	"duration_minutes" integer,
	"legs" jsonb,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"origins" text[] NOT NULL,
	"destinations" text[] NOT NULL,
	"trip_type" "trip_type" DEFAULT 'round_trip' NOT NULL,
	"date_mode" date_mode DEFAULT 'window' NOT NULL,
	"depart_date" date,
	"return_date" date,
	"window_start" date,
	"window_end" date,
	"horizon_days" integer,
	"min_stay_days" integer,
	"max_stay_days" integer,
	"target_price" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"cabin" "cabin" DEFAULT 'economy' NOT NULL,
	"max_stops" integer,
	"schedule" jsonb DEFAULT '[{"from":0,"to":24,"every":2}]'::jsonb NOT NULL,
	"max_queries_per_run" integer DEFAULT 60 NOT NULL,
	"notify_email" text,
	"active" boolean DEFAULT true NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"routes_checked" integer DEFAULT 0 NOT NULL,
	"queries" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"alerts_sent" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_checks" ADD CONSTRAINT "price_checks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_route_sent_idx" ON "alerts" USING btree ("route_id","sent_at");--> statement-breakpoint
CREATE INDEX "price_checks_route_checked_idx" ON "price_checks" USING btree ("route_id","checked_at");--> statement-breakpoint
CREATE INDEX "price_checks_route_price_idx" ON "price_checks" USING btree ("route_id","price");
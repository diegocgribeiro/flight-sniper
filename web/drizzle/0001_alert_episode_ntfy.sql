ALTER TABLE "alerts" ADD COLUMN "ntfy_topic" text;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "ntfy_topic" text;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "alert_floor" numeric(10, 2);--> statement-breakpoint
-- Preserva a supressão atual: o piso do episódio começa no menor preço alertado nas últimas 24h.
UPDATE "routes" SET "alert_floor" = (
  SELECT min(a."best_price") FROM "alerts" a
  WHERE a."route_id" = "routes"."id" AND a."sent_at" > now() - interval '24 hours'
);

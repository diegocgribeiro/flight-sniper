import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const tripTypeEnum = pgEnum("trip_type", ["one_way", "round_trip"]);

/**
 * fixed   → ida (e volta) em datas exatas
 * window  → ida e volta dentro de [window_start, window_end]
 * rolling → próximos `horizon_days` dias, com duração entre min/max_stay_days
 */
export const dateModeEnum = pgEnum("date_mode", ["fixed", "window", "rolling"]);

export const cabinEnum = pgEnum("cabin", [
  "economy",
  "premium-economy",
  "business",
  "first",
]);

/** Faixa de horário (America/Sao_Paulo) e intervalo de checagem em horas. */
export type ScheduleRule = { from: number; to: number; every: number };

export const routes = pgTable("routes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  origins: text("origins").array().notNull(),
  destinations: text("destinations").array().notNull(),
  tripType: tripTypeEnum("trip_type").notNull().default("round_trip"),
  dateMode: dateModeEnum("date_mode").notNull().default("window"),

  // fixed
  departDate: date("depart_date"),
  returnDate: date("return_date"),
  // window
  windowStart: date("window_start"),
  windowEnd: date("window_end"),
  // rolling
  horizonDays: integer("horizon_days"),
  // window / rolling (ida e volta)
  minStayDays: integer("min_stay_days"),
  maxStayDays: integer("max_stay_days"),

  targetPrice: numeric("target_price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  adults: integer("adults").notNull().default(1),
  cabin: cabinEnum("cabin").notNull().default("economy"),
  maxStops: integer("max_stops"),

  schedule: jsonb("schedule")
    .$type<ScheduleRule[]>()
    .notNull()
    .default([{ from: 0, to: 24, every: 2 }]),
  maxQueriesPerRun: integer("max_queries_per_run").notNull().default(60),
  notifyEmail: text("notify_email"),
  /** Tópico do ntfy.sh (opcional); o e-mail é sempre enviado. */
  ntfyTopic: text("ntfy_topic"),
  /**
   * Menor preço já alertado no "episódio" atual abaixo da meta. Só realerta
   * abaixo dele; volta a null quando o preço sobe acima da meta (worker).
   */
  alertFloor: numeric("alert_floor", { precision: 10, scale: 2 }),

  active: boolean("active").notNull().default(true),
  /** Posição da janela rotativa de combinações (worker). */
  cursor: integer("cursor").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  trigger: text("trigger").notNull().default("schedule"),
  routesChecked: integer("routes_checked").notNull().default(0),
  queries: integer("queries").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  alertsSent: integer("alerts_sent").notNull().default(0),
  status: text("status").notNull().default("running"),
  message: text("message"),
});

export const priceChecks = pgTable(
  "price_checks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    routeId: integer("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    departDate: date("depart_date").notNull(),
    returnDate: date("return_date"),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    airlines: text("airlines").array().notNull(),
    stops: integer("stops").notNull(),
    durationMinutes: integer("duration_minutes"),
    legs: jsonb("legs"),
    url: text("url").notNull(),
  },
  (t) => [
    index("price_checks_route_checked_idx").on(t.routeId, t.checkedAt),
    index("price_checks_route_price_idx").on(t.routeId, t.price),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    routeId: integer("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    bestPrice: numeric("best_price", { precision: 10, scale: 2 }).notNull(),
    departDate: date("depart_date").notNull(),
    returnDate: date("return_date"),
    emailTo: text("email_to").notNull(),
    ntfyTopic: text("ntfy_topic"),
    providerId: text("provider_id"),
  },
  (t) => [index("alerts_route_sent_idx").on(t.routeId, t.sentAt)],
);

export type Route = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;
export type PriceCheck = typeof priceChecks.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Run = typeof runs.$inferSelect;

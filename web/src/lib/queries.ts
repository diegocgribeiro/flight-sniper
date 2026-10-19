import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { routes, priceChecks, alerts, runs } = schema;

/** Janela considerada "preço atual": o resultado mais recente de cada combinação nas últimas 48h. */
const FRESH = sql`now() - interval '48 hours'`;

export async function listRoutesWithStats() {
  const rows = await db()
    .select({
      route: routes,
      bestNow: sql<string | null>`(
        select min(pc.price) from ${priceChecks} pc
        where pc.route_id = ${routes.id} and pc.checked_at > ${FRESH}
      )`,
      bestEver: sql<string | null>`(
        select min(pc.price) from ${priceChecks} pc where pc.route_id = ${routes.id}
      )`,
      lastAlertAt: sql<string | null>`(
        select max(a.sent_at) from ${alerts} a where a.route_id = ${routes.id}
      )`,
    })
    .from(routes)
    .orderBy(desc(routes.active), routes.name);
  return rows;
}

export async function getRoute(id: number) {
  const [route] = await db().select().from(routes).where(eq(routes.id, id));
  return route ?? null;
}

/** Melhores opções atuais: última observação por combinação (48h), ordenadas por preço. */
export async function currentBestOptions(routeId: number, limit = 12) {
  const res = await db().execute(sql`
    select * from (
      select distinct on (origin, destination, depart_date, return_date)
        id, checked_at, origin, destination, depart_date, return_date, price, currency,
        airlines, stops, duration_minutes, url
      from ${priceChecks}
      where route_id = ${routeId} and checked_at > ${FRESH}
      order by origin, destination, depart_date, return_date, checked_at desc
    ) latest
    order by price asc
    limit ${limit}
  `);
  return res.rows as {
    id: number;
    checked_at: string;
    origin: string;
    destination: string;
    depart_date: string;
    return_date: string | null;
    price: string;
    currency: string;
    airlines: string[];
    stops: number;
    duration_minutes: number | null;
    url: string;
  }[];
}

/** Menor preço por dia (fuso de São Paulo) nos últimos N dias, para o gráfico. */
export async function dailyMinSeries(routeId: number, days = 30) {
  const res = await db().execute(sql`
    select to_char(date_trunc('day', checked_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as day,
           min(price)::float as price
    from ${priceChecks}
    where route_id = ${routeId} and checked_at > now() - make_interval(days => ${days})
    group by 1 order by 1
  `);
  return res.rows as { day: string; price: number }[];
}

export async function routeAlerts(routeId: number, limit = 10) {
  return db()
    .select()
    .from(alerts)
    .where(eq(alerts.routeId, routeId))
    .orderBy(desc(alerts.sentAt))
    .limit(limit);
}

export async function recentRuns(limit = 8) {
  return db().select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
}

import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { routes, priceChecks, alerts, runs } = schema;

const ROUTE_ID = sql.raw(`"routes"."id"`);

/** run_id da varredura mais recente que gravou preços para a rota informada. */
const lastRunOf = (routeId: unknown) => sql`(
  select pc2.run_id from ${priceChecks} pc2
  where pc2.route_id = ${routeId} order by pc2.checked_at desc limit 1
)`;

export async function listRoutesWithStats() {
  const rows = await db()
    .select({
      route: routes,
      // Referência qualificada: dentro da subconsulta, ${routes.id} vira só "id"
      // e o Postgres resolve para a coluna id da própria tabela da subconsulta.
      // Menor preço encontrado na última varredura da rota.
      lastScan: sql<string | null>`(
        select min(pc.price) from ${priceChecks} pc
        where pc.route_id = ${ROUTE_ID} and pc.run_id = ${lastRunOf(ROUTE_ID)}
      )`,
      bestEver: sql<string | null>`(
        select min(pc.price) from ${priceChecks} pc where pc.route_id = ${ROUTE_ID}
      )`,
      lastAlertAt: sql<string | null>`(
        select max(a.sent_at) from ${alerts} a where a.route_id = ${ROUTE_ID}
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

/** Resultados da última varredura da rota, do mais barato para o mais caro. */
export async function lastScanOptions(routeId: number, limit = 12) {
  const res = await db().execute(sql`
    select id, checked_at, origin, destination, depart_date, return_date, price, currency,
           airlines, stops, duration_minutes, url
    from ${priceChecks}
    where route_id = ${routeId} and run_id = ${lastRunOf(routeId)}
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

/**
 * Menor preço de cada varredura (as últimas N execuções que gravaram preços da rota),
 * em ordem cronológica, para o gráfico. `label` vem formatado no horário de São Paulo.
 */
export async function runMinSeries(routeId: number, limit = 120) {
  const res = await db().execute(sql`
    select at, label, price from (
      select min(checked_at) as at,
             to_char(min(checked_at) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as label,
             min(price)::float as price
      from ${priceChecks}
      where route_id = ${routeId} and run_id is not null
      group by run_id
      order by at desc
      limit ${limit}
    ) r
    order by at
  `);
  return res.rows as { at: string; label: string; price: number }[];
}

/** Menor preço já visto para a rota (todo o histórico guardado). */
export async function historicalMin(routeId: number) {
  const res = await db().execute(sql`select min(price) as p from ${priceChecks} where route_id = ${routeId}`);
  return (res.rows[0]?.p as string | null) ?? null;
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

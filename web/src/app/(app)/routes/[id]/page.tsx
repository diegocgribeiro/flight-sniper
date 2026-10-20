import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRoute, toggleRoute } from "@/app/actions";
import { PriceChart } from "@/components/price-chart";
import { RunNowButton } from "@/components/run-now-button";
import {
  CABIN_LABEL,
  describeDates,
  describeSchedule,
  fmtDateShort,
  fmtDateTime,
  money,
  stopsLabel,
  timeAgo,
} from "@/lib/format";
import { getRoute, historicalMin, lastScanOptions, routeAlerts, runMinSeries } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export default async function RoutePage(props: PageProps<"/routes/[id]">) {
  await requireSession();
  const { id } = await props.params;
  const routeId = Number(id);
  const route = await getRoute(routeId);
  if (!route) notFound();

  const [options, series, alerts, bestEver] = await Promise.all([
    lastScanOptions(routeId),
    runMinSeries(routeId),
    routeAlerts(routeId),
    historicalMin(routeId),
  ]);
  const target = Number(route.targetPrice);
  const rt = route.tripType === "round_trip";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-muted hover:underline">← Rotas</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{route.name}</h1>
          <p className="font-mono text-muted">
            {route.origins.join("/")} {rt ? "⇄" : "→"} {route.destinations.join("/")}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <RunNowButton routeId={route.id} />
          <Link href={`/routes/${route.id}/edit`} className="btn-ghost">Editar</Link>
          <form action={toggleRoute.bind(null, route.id, !route.active)}>
            <button className="btn-ghost">{route.active ? "Pausar" : "Reativar"}</button>
          </form>
          <form action={deleteRoute.bind(null, route.id)}>
            <button className="btn-danger">Excluir</button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Última varredura" value={money(options[0]?.price, route.currency)} good={!!options[0] && Number(options[0].price) < target} />
        <Stat label="Mínimo histórico" value={money(bestEver, route.currency)} good={bestEver != null && Number(bestEver) < target} />
        <Stat label="Preço alvo" value={money(target, route.currency)} />
        <Stat label="Última checagem" value={`${timeAgo(route.lastCheckedAt)}${route.active ? "" : " · pausada"}`} />
      </div>

      <section className="card grid gap-2 p-5 text-sm sm:grid-cols-2">
        <div>📅 {describeDates(route)}</div>
        <div>⏱ {describeSchedule(route.schedule)}</div>
        <div>
          👤 {route.adults} adulto(s) · {CABIN_LABEL[route.cabin]} ·{" "}
          {route.maxStops == null ? "qualquer nº de paradas" : `até ${stopsLabel(route.maxStops).toLowerCase()}`}
        </div>
        <div>
          ✉ {route.notifyEmail ?? process.env.ALERT_EMAIL ?? "—"}
          {route.ntfyTopic && <> · 🔔 ntfy: <span className="font-mono">{route.ntfyTopic}</span></>}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Menor preço por varredura</h2>
        <PriceChart data={series} target={target} currency={route.currency} />
      </section>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 font-semibold">Resultados da última varredura</h2>
        {options.length === 0 ? (
          <p className="text-sm text-muted">Nenhum resultado ainda.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="pb-2">Trecho</th>
                <th className="pb-2">Ida</th>
                {rt && <th className="pb-2">Volta</th>}
                <th className="pb-2">Cia</th>
                <th className="pb-2">Paradas</th>
                <th className="pb-2 text-right">Preço</th>
                <th className="pb-2 text-right">Visto</th>
                <th />
              </tr>
            </thead>
            <tbody className="tabular">
              {options.map((o) => {
                const below = Number(o.price) < target;
                return (
                  <tr key={o.id} className="border-t border-line">
                    <td className="py-2 font-mono">{o.origin}→{o.destination}</td>
                    <td>{fmtDateShort(o.depart_date)}</td>
                    {rt && <td>{fmtDateShort(o.return_date)}</td>}
                    <td>{o.airlines.join(", ")}</td>
                    <td>{stopsLabel(o.stops)}</td>
                    <td className={`text-right font-semibold ${below ? "text-good" : ""}`}>
                      {money(o.price, o.currency)}
                    </td>
                    <td className="text-right text-muted">{timeAgo(o.checked_at)}</td>
                    <td className="text-right">
                      <a href={o.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        Google Flights ↗
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Alertas enviados</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted">Nenhum alerta ainda. Você é avisado quando o preço fica abaixo do alvo e de novo a cada nova queda.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex justify-between border-t border-line py-2 first:border-0">
                <span>
                  {fmtDateTime(a.sentAt)} — {fmtDateShort(a.departDate)}
                  {a.returnDate && ` → ${fmtDateShort(a.returnDate)}`}
                </span>
                <span className="tabular font-semibold text-good">{money(a.bestPrice, route.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`tabular text-xl font-semibold ${good ? "text-good" : ""}`}>{value}</div>
    </div>
  );
}

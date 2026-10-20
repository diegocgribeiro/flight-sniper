import Link from "next/link";
import { RunNowButton } from "@/components/run-now-button";
import { describeDates, describeSchedule, fmtDateTime, fmtNextCheck, money, nextCheck, timeAgo } from "@/lib/format";
import { listRoutesWithStats, recentRuns } from "@/lib/queries";
import { requireSession } from "@/lib/session";

export default async function Dashboard() {
  await requireSession();
  const [rows, runs] = await Promise.all([listRoutesWithStats(), recentRuns(5)]);
  const lastRun = runs[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suas rotas</h1>
          <p className="text-sm text-muted">
            Última varredura: {lastRun ? `${timeAgo(lastRun.startedAt)} (${lastRun.status})` : "nenhuma ainda"}
          </p>
        </div>
        <RunNowButton routeId={null} label="Buscar todas agora" />
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-medium">Nenhuma rota cadastrada</p>
          <p className="mt-1 text-sm text-muted">Cadastre uma rota e defina o preço alvo para começar a receber alertas.</p>
          <Link href="/routes/new" className="btn-primary mt-4">+ Nova rota</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ route: r, lastScan, bestEver, lastAlertAt }) => {
            const below = lastScan != null && Number(lastScan) < Number(r.targetPrice);
            return (
              <Link key={r.id} href={`/routes/${r.id}`} className="card block p-5 transition hover:border-brand">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{r.name}</span>
                      {!r.active && (
                        <span className="rounded bg-bg px-1.5 py-0.5 text-[11px] text-muted">pausada</span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-sm text-muted">
                      {r.origins.join("/")} {r.tripType === "round_trip" ? "⇄" : "→"} {r.destinations.join("/")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`tabular text-xl font-semibold ${below ? "text-good" : ""}`}>
                      {money(lastScan, r.currency)}
                    </div>
                    <div className="text-xs text-muted">última varredura · alvo {money(r.targetPrice, r.currency)}</div>
                  </div>
                </div>
                <div className="mt-4 space-y-1 text-sm text-muted">
                  <div>📅 {describeDates(r)}</div>
                  <div>⏱ {describeSchedule(r.schedule)}</div>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
                  <span>Checado: {fmtDateTime(r.lastCheckedAt)}</span>
                  {r.active && <span>Próxima: {fmtNextCheck(nextCheck(r.schedule, r.lastCheckedAt))}</span>}
                  <span>Mínimo histórico: {money(bestEver, r.currency)}</span>
                  {lastAlertAt && <span>Último alerta: {timeAgo(lastAlertAt)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {runs.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Execuções recentes</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="pb-2">Início</th>
                <th className="pb-2">Origem</th>
                <th className="pb-2 text-right">Rotas</th>
                <th className="pb-2 text-right">Buscas</th>
                <th className="pb-2 text-right">Erros</th>
                <th className="pb-2 text-right">Alertas</th>
                <th className="pb-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-line">
                  <td className="py-2">{fmtDateTime(run.startedAt)}</td>
                  <td>{run.trigger}</td>
                  <td className="text-right">{run.routesChecked}</td>
                  <td className="text-right">{run.queries}</td>
                  <td className={`text-right ${run.errors ? "text-warn" : ""}`}>{run.errors}</td>
                  <td className="text-right">{run.alertsSent}</td>
                  <td className="text-right" title={run.message ?? ""}>{run.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

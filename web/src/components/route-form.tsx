"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { saveRoute, testNtfy, type FormState } from "@/app/actions";
import { AirportPicker } from "@/components/airport-picker";
import type { Route, ScheduleRule } from "@/db/schema";
import { SCHEDULE_PRESETS, countDateCombos } from "@/lib/route-input";

type Props = { route?: Route; defaultEmail?: string; airportLabels?: Record<string, string> };

const ROLLING_PRESETS = [
  { label: "1 mês", days: 30 },
  { label: "3 meses", days: 90 },
  { label: "6 meses", days: 180 },
  { label: "Amplo (11 meses)", days: 330 },
];

function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string[];
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-bad">{error[0]}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <label
          key={o.value}
          className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
            value === o.value ? "border-brand bg-brand/10" : "border-line hover:bg-bg"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          <div className="font-medium">{o.label}</div>
          {o.hint && <div className="mt-0.5 text-xs text-muted">{o.hint}</div>}
        </label>
      ))}
    </div>
  );
}

export function RouteForm({ route, defaultEmail, airportLabels = {} }: Props) {
  const action = saveRoute.bind(null, route?.id ?? null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  const e = state?.errors ?? {};

  const [tripType, setTripType] = useState<"one_way" | "round_trip">(route?.tripType ?? "round_trip");
  const [dateMode, setDateMode] = useState<"fixed" | "window" | "rolling">(route?.dateMode ?? "window");
  const [windowStart, setWindowStart] = useState(route?.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(route?.windowEnd ?? "");
  const [horizonDays, setHorizonDays] = useState<number>(route?.horizonDays ?? 180);
  const [minStay, setMinStay] = useState<number>(route?.minStayDays ?? 4);
  const [maxStay, setMaxStay] = useState<number>(route?.maxStayDays ?? 4);
  const [origins, setOrigins] = useState<string[]>(route?.origins ?? []);
  const [destinations, setDestinations] = useState<string[]>(route?.destinations ?? []);
  const [ntfyTopic, setNtfyTopic] = useState(route?.ntfyTopic ?? "");
  const [ntfyMsg, setNtfyMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [maxQueries, setMaxQueries] = useState<number>(route?.maxQueriesPerRun ?? 60);
  const [schedule, setSchedule] = useState<ScheduleRule[]>(
    route?.schedule ?? SCHEDULE_PRESETS[0].rules,
  );

  const rt = tripType === "round_trip";
  const airportPairs = Math.max(1, origins.length) * Math.max(1, destinations.length);
  const combos = useMemo(
    () =>
      countDateCombos({
        tripType,
        dateMode,
        windowStart,
        windowEnd,
        horizonDays,
        minStayDays: minStay,
        maxStayDays: maxStay,
      }) * airportPairs,
    [tripType, dateMode, windowStart, windowEnd, horizonDays, minStay, maxStay, airportPairs],
  );
  const sampled = combos > maxQueries;

  const updateRule = (i: number, patch: Partial<ScheduleRule>) =>
    setSchedule((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="schedule" value={JSON.stringify(schedule)} />

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Rota</h2>
        <Field label="Nome" error={e.name}>
          <input name="name" className="input" defaultValue={route?.name} placeholder="Réveillon em Lisboa" required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origem" error={e.origins} hint="Digite a cidade, o aeroporto ou o código (até 5)">
            <AirportPicker
              name="origins"
              value={origins}
              onChange={setOrigins}
              labels={airportLabels}
              placeholder="Ex.: Uberlândia"
            />
          </Field>
          <Field label="Destino" error={e.destinations} hint="Cidades com vários aeroportos podem entrar todos de uma vez">
            <AirportPicker
              name="destinations"
              value={destinations}
              onChange={setDestinations}
              labels={airportLabels}
              placeholder="Ex.: São Paulo"
            />
          </Field>
        </div>
        <Field label="Tipo de viagem">
          <Segmented
            name="tripType"
            value={tripType}
            onChange={setTripType}
            options={[
              { value: "round_trip", label: "Ida e volta" },
              { value: "one_way", label: "Só ida" },
            ]}
          />
        </Field>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Datas</h2>
        <Segmented
          name="dateMode"
          value={dateMode}
          onChange={setDateMode}
          options={[
            { value: "fixed", label: "Data fixa", hint: "Dias exatos" },
            { value: "window", label: "Período", hint: "Ex.: 01 a 12/dez" },
            { value: "rolling", label: "Próximos meses", hint: "Flexível / amplo" },
          ]}
        />

        {dateMode === "fixed" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ida" error={e.departDate}>
              <input type="date" name="departDate" className="input" defaultValue={route?.departDate ?? ""} />
            </Field>
            {rt && (
              <Field label="Volta" error={e.returnDate}>
                <input type="date" name="returnDate" className="input" defaultValue={route?.returnDate ?? ""} />
              </Field>
            )}
          </div>
        )}

        {dateMode === "window" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Início do período" error={e.windowStart}>
              <input
                type="date"
                name="windowStart"
                className="input"
                value={windowStart}
                onChange={(ev) => setWindowStart(ev.target.value)}
              />
            </Field>
            <Field label="Fim do período" error={e.windowEnd} hint={rt ? "A volta precisa caber até esta data" : undefined}>
              <input
                type="date"
                name="windowEnd"
                className="input"
                value={windowEnd}
                onChange={(ev) => setWindowEnd(ev.target.value)}
              />
            </Field>
          </div>
        )}

        {dateMode === "rolling" && (
          <Field label="Horizonte" error={e.horizonDays}>
            <div className="flex flex-wrap items-center gap-2">
              {ROLLING_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.days}
                  onClick={() => setHorizonDays(p.days)}
                  className={`btn ${horizonDays === p.days ? "bg-brand text-brand-ink" : "border border-line"}`}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="number"
                name="horizonDays"
                min={1}
                max={330}
                className="input w-28"
                value={horizonDays}
                onChange={(ev) => setHorizonDays(Number(ev.target.value))}
              />
              <span className="text-sm text-muted">dias</span>
            </div>
          </Field>
        )}

        {rt && dateMode !== "fixed" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duração mínima (dias)" error={e.minStayDays}>
              <input
                type="number"
                name="minStayDays"
                min={0}
                max={60}
                className="input"
                value={minStay}
                onChange={(ev) => {
                  const v = Number(ev.target.value);
                  setMinStay(v);
                  if (v > maxStay) setMaxStay(v);
                }}
              />
            </Field>
            <Field label="Duração máxima (dias)" error={e.maxStayDays}>
              <input
                type="number"
                name="maxStayDays"
                min={0}
                max={60}
                className="input"
                value={maxStay}
                onChange={(ev) => setMaxStay(Number(ev.target.value))}
              />
            </Field>
          </div>
        )}

        {dateMode !== "fixed" && (
          <div className="rounded-lg bg-bg p-3 text-sm">
            <b className="tabular">{combos.toLocaleString("pt-BR")}</b> combinações possíveis de datas/aeroportos.{" "}
            {combos > 0 && (
              <span className="text-muted">
                {sampled ? (
                  <>
                    Cada execução faz uma <b>amostra de {maxQueries} buscas</b> espalhada pelo período todo
                    (idas distribuídas e durações alternadas), então a estimativa de preço sai já na primeira
                    varredura.
                  </>
                ) : (
                  <>Todas são buscadas em cada execução.</>
                )}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Preço e filtros</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Preço alvo (R$)" error={e.targetPrice} hint="Total por pessoa, ida+volta">
            <input
              type="number"
              name="targetPrice"
              min={1}
              step="1"
              className="input tabular"
              defaultValue={route ? Number(route.targetPrice) : ""}
              required
            />
          </Field>
          <Field label="Adultos" error={e.adults}>
            <input type="number" name="adults" min={1} max={9} className="input" defaultValue={route?.adults ?? 1} />
          </Field>
          <Field label="Cabine">
            <select name="cabin" className="input" defaultValue={route?.cabin ?? "economy"}>
              <option value="economy">Econômica</option>
              <option value="premium-economy">Premium Economy</option>
              <option value="business">Executiva</option>
              <option value="first">Primeira</option>
            </select>
          </Field>
          <Field label="Máx. de paradas">
            <select name="maxStops" className="input" defaultValue={route?.maxStops ?? ""}>
              <option value="">Qualquer</option>
              <option value="0">Só direto</option>
              <option value="1">Até 1</option>
              <option value="2">Até 2</option>
            </select>
          </Field>
        </div>
        <input type="hidden" name="currency" value="BRL" />
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Frequência das buscas</h2>
          <p className="text-sm text-muted">
            Horário de Brasília, em horários cheios: &quot;a cada 2h das 6h às 24h&quot; busca às 6h, 8h, 10h…
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              className={`btn ${JSON.stringify(p.rules) === JSON.stringify(schedule) ? "bg-brand text-brand-ink" : "border border-line"}`}
              onClick={() => setSchedule(p.rules)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {schedule.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span>Das</span>
              <input
                type="number"
                min={0}
                max={23}
                className="input w-20"
                value={rule.from}
                onChange={(ev) => updateRule(i, { from: Number(ev.target.value) })}
              />
              <span>h às</span>
              <input
                type="number"
                min={1}
                max={24}
                className="input w-20"
                value={rule.to}
                onChange={(ev) => updateRule(i, { to: Number(ev.target.value) })}
              />
              <span>h, a cada</span>
              <input
                type="number"
                min={1}
                max={24}
                className="input w-20"
                value={rule.every}
                onChange={(ev) => updateRule(i, { every: Number(ev.target.value) })}
              />
              <span>hora(s)</span>
              {schedule.length > 1 && (
                <button
                  type="button"
                  className="btn text-bad"
                  onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))}
                >
                  remover
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setSchedule((s) => [...s, { from: 0, to: 6, every: 1 }])}
          >
            + Faixa
          </button>
          {e.schedule && <p className="text-xs text-bad">{e.schedule[0]}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Máx. de buscas por execução"
            error={e.maxQueriesPerRun}
            hint="Cada busca leva ~2–3s. Acima disso, as datas viram uma amostra representativa."
          >
            <input
              type="number"
              name="maxQueriesPerRun"
              min={1}
              max={300}
              className="input"
              value={maxQueries}
              onChange={(ev) => setMaxQueries(Number(ev.target.value))}
            />
          </Field>
          <Field label="E-mail do alerta" error={e.notifyEmail}>
            <input
              type="email"
              name="notifyEmail"
              className="input"
              defaultValue={route?.notifyEmail ?? defaultEmail ?? ""}
              placeholder="voce@exemplo.com"
              required
            />
          </Field>
        </div>
        <Field
          label="Tópico ntfy.sh (opcional)"
          error={e.ntfyTopic}
          hint="Notificação no celular além do e-mail. Instale o app ntfy, assine o mesmo tópico. Tópicos são públicos: use um nome difícil de adivinhar."
        >
          <div className="flex gap-2">
            <input
              name="ntfyTopic"
              className="input font-mono"
              value={ntfyTopic}
              onChange={(ev) => {
                setNtfyTopic(ev.target.value);
                setNtfyMsg(null);
              }}
              placeholder="voos-diego-7k2p9"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-ghost shrink-0"
              disabled={!ntfyTopic.trim() || testing}
              onClick={() => startTest(async () => setNtfyMsg(await testNtfy(ntfyTopic)))}
            >
              {testing ? "Enviando…" : "Testar"}
            </button>
          </div>
          {ntfyMsg && <p className={`mt-1 text-xs ${ntfyMsg.ok ? "text-good" : "text-bad"}`}>{ntfyMsg.message}</p>}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={route?.active ?? true} />
          Rota ativa
        </label>
      </section>

      <div className="flex items-center justify-end gap-3">
        {state?.message && <span className="text-sm text-bad">{state.message}</span>}
        <button className="btn-primary" disabled={pending}>
          {pending ? "Salvando…" : route ? "Salvar alterações" : "Criar rota"}
        </button>
      </div>
    </form>
  );
}

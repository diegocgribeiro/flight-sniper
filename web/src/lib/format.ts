import type { Route, ScheduleRule } from "@/db/schema";

export function money(value: string | number | null | undefined, currency = "BRL"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number(value),
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", weekday: "short", timeZone: "UTC" });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "nunca";
  return new Date(d).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "nunca";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function describeDates(r: Route): string {
  const rt = r.tripType === "round_trip";
  const stay =
    rt && r.minStayDays != null
      ? r.minStayDays === r.maxStayDays
        ? `, ${r.minStayDays} dias de viagem`
        : `, ${r.minStayDays}–${r.maxStayDays} dias de viagem`
      : "";
  switch (r.dateMode) {
    case "fixed":
      return rt ? `${fmtDate(r.departDate)} → ${fmtDate(r.returnDate)}` : `Ida em ${fmtDate(r.departDate)}`;
    case "window":
      return `Entre ${fmtDate(r.windowStart)} e ${fmtDate(r.windowEnd)}${stay}`;
    case "rolling": {
      const d = r.horizonDays ?? 0;
      const label = d % 30 === 0 ? `${d / 30} ${d === 30 ? "mês" : "meses"}` : `${d} dias`;
      return `Próximos ${label}${stay}`;
    }
  }
}

export function describeSchedule(rules: ScheduleRule[]): string {
  return rules
    .map((r) => {
      const every = r.every === 1 ? "a cada 1h" : `a cada ${r.every}h`;
      return r.from === 0 && r.to === 24 ? `${every}, o dia todo` : `${every} das ${r.from}h às ${r.to}h`;
    })
    .join(" · ");
}

export const CABIN_LABEL: Record<string, string> = {
  economy: "Econômica",
  "premium-economy": "Premium Economy",
  business: "Executiva",
  first: "Primeira",
};

export function stopsLabel(n: number): string {
  return n === 0 ? "Direto" : n === 1 ? "1 parada" : `${n} paradas`;
}

const HOUR = 3_600_000;
/** Mesma antecipação tolerada pelo worker (schedule.py). */
const LEAD = 5 * 60_000;

function spHour(t: number): number {
  return Number(
    new Date(t).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }),
  );
}

/**
 * Próximo horário agendado da rota (espelha worker/flight_sniper/schedule.py).
 * Retorna o horário atual se ele ainda não foi checado (busca pendente).
 */
export function nextCheck(rules: ScheduleRule[], last: Date | string | null, now = Date.now()): Date | null {
  const lastT = last ? new Date(last).getTime() : null;
  const hourStart = Math.floor(now / HOUR) * HOUR;
  const ruleAt = (h: number) => rules.find((r) => r.from <= h && h < r.to);

  const h0 = spHour(hourStart);
  const cur = ruleAt(h0);
  if (cur) {
    const slotT = hourStart - ((h0 - cur.from) % cur.every) * HOUR;
    if (lastT == null || lastT < slotT - LEAD) return new Date(slotT);
  }
  for (let i = 1; i <= 48; i++) {
    const t = hourStart + i * HOUR;
    const h = spHour(t);
    const r = ruleAt(h);
    if (r && (h - r.from) % r.every === 0) return new Date(t);
  }
  return null;
}

export function fmtNextCheck(d: Date | null, now = Date.now()): string {
  if (!d) return "fora das faixas";
  const hhmm = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return d.getTime() <= now ? `pendente (${hhmm})` : hhmm;
}

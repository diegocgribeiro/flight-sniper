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

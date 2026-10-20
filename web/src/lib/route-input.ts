import { z } from "zod";
import type { ScheduleRule } from "@/db/schema";

const iataList = z
  .string()
  .transform((s) =>
    s
      .split(/[\s,;]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().regex(/^[A-Z]{3}$/, "Use códigos IATA de 3 letras (ex.: UDI, GRU)"))
      .min(1, "Informe ao menos um aeroporto")
      .max(5, "Máximo de 5 aeroportos"),
  );

/** Tópicos do ntfy.sh são públicos: quem souber o nome lê as mensagens. */
export const ntfyTopic = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{6,64}$/, "Use 6–64 letras, números, - ou _ (sem espaços)")
    .nullable(),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const optInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(min).max(max).nullable(),
  );

const scheduleRule = z
  .object({
    from: z.number().int().min(0).max(23),
    to: z.number().int().min(1).max(24),
    every: z.number().int().min(1).max(24),
  })
  .refine((r) => r.to > r.from, "Faixa de horário inválida");

export const routeInputSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome à rota").max(80),
    origins: iataList,
    destinations: iataList,
    tripType: z.enum(["one_way", "round_trip"]),
    dateMode: z.enum(["fixed", "window", "rolling"]),
    departDate: isoDate.nullable(),
    returnDate: isoDate.nullable(),
    windowStart: isoDate.nullable(),
    windowEnd: isoDate.nullable(),
    horizonDays: optInt(1, 330),
    minStayDays: optInt(0, 60),
    maxStayDays: optInt(0, 60),
    targetPrice: z.preprocess((v) => Number(v), z.number().positive("Preço alvo deve ser > 0")),
    currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
    adults: z.preprocess((v) => Number(v), z.number().int().min(1).max(9)),
    cabin: z.enum(["economy", "premium-economy", "business", "first"]),
    maxStops: optInt(0, 3),
    schedule: z.array(scheduleRule).min(1, "Defina ao menos uma faixa de horário"),
    maxQueriesPerRun: z.preprocess((v) => Number(v), z.number().int().min(1).max(300)),
    notifyEmail: z.string({ error: "Informe o e-mail do alerta" }).trim().pipe(z.email("E-mail inválido")),
    ntfyTopic,
    active: z.boolean(),
  })
  .superRefine((r, ctx) => {
    const rt = r.tripType === "round_trip";
    if (r.dateMode === "fixed") {
      if (!r.departDate) ctx.addIssue({ code: "custom", path: ["departDate"], message: "Informe a data de ida" });
      if (rt && !r.returnDate) ctx.addIssue({ code: "custom", path: ["returnDate"], message: "Informe a data de volta" });
      if (rt && r.departDate && r.returnDate && r.returnDate < r.departDate)
        ctx.addIssue({ code: "custom", path: ["returnDate"], message: "Volta antes da ida" });
    }
    if (r.dateMode === "window") {
      if (!r.windowStart || !r.windowEnd)
        ctx.addIssue({ code: "custom", path: ["windowStart"], message: "Informe início e fim do período" });
      else if (r.windowEnd < r.windowStart)
        ctx.addIssue({ code: "custom", path: ["windowEnd"], message: "Fim antes do início" });
    }
    if (r.dateMode === "rolling" && !r.horizonDays)
      ctx.addIssue({ code: "custom", path: ["horizonDays"], message: "Informe o horizonte em dias" });
    if (rt && r.dateMode !== "fixed") {
      if (r.minStayDays == null || r.maxStayDays == null)
        ctx.addIssue({ code: "custom", path: ["minStayDays"], message: "Informe a duração mín. e máx." });
      else if (r.maxStayDays < r.minStayDays)
        ctx.addIssue({ code: "custom", path: ["maxStayDays"], message: "Máx. menor que mín." });
    }
    const covered = new Set<number>();
    for (const rule of r.schedule) {
      for (let h = rule.from; h < rule.to; h++) {
        if (covered.has(h)) {
          ctx.addIssue({ code: "custom", path: ["schedule"], message: "Faixas de horário se sobrepõem" });
          return;
        }
        covered.add(h);
      }
    }
  });

export type RouteInput = z.infer<typeof routeInputSchema>;

export function parseRouteForm(fd: FormData) {
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v !== "" ? v : null;
  };
  let schedule: unknown = [];
  try {
    schedule = JSON.parse(str("schedule") ?? "[]");
  } catch {
    schedule = [];
  }
  return routeInputSchema.safeParse({
    name: str("name") ?? "",
    origins: str("origins") ?? "",
    destinations: str("destinations") ?? "",
    tripType: str("tripType"),
    dateMode: str("dateMode"),
    departDate: str("departDate"),
    returnDate: str("returnDate"),
    windowStart: str("windowStart"),
    windowEnd: str("windowEnd"),
    horizonDays: str("horizonDays"),
    minStayDays: str("minStayDays"),
    maxStayDays: str("maxStayDays"),
    targetPrice: str("targetPrice"),
    currency: str("currency") ?? "BRL",
    adults: str("adults") ?? "1",
    cabin: str("cabin") ?? "economy",
    maxStops: str("maxStops"),
    schedule,
    maxQueriesPerRun: str("maxQueriesPerRun") ?? "60",
    notifyEmail: str("notifyEmail"),
    ntfyTopic: str("ntfyTopic"),
    active: fd.get("active") === "on",
  });
}

/** Presets de agenda exibidos no formulário. */
export const SCHEDULE_PRESETS: { label: string; rules: ScheduleRule[] }[] = [
  { label: "A cada 2h o dia todo", rules: [{ from: 0, to: 24, every: 2 }] },
  {
    label: "1h de madrugada, 2h no resto",
    rules: [
      { from: 0, to: 6, every: 1 },
      { from: 6, to: 24, every: 2 },
    ],
  },
  { label: "A cada 1h", rules: [{ from: 0, to: 24, every: 1 }] },
  { label: "A cada 6h", rules: [{ from: 0, to: 24, every: 6 }] },
];

/**
 * Conta as combinações de datas (espelha worker/flight_sniper/dates.py),
 * usado só para mostrar uma estimativa no formulário.
 */
export function countDateCombos(r: {
  tripType: string;
  dateMode: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  horizonDays?: number | null;
  minStayDays?: number | null;
  maxStayDays?: number | null;
}): number {
  if (r.dateMode === "fixed") return 1;
  const DAY = 86_400_000;
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  let start: number, end: number;
  if (r.dateMode === "window") {
    if (!r.windowStart || !r.windowEnd) return 0;
    start = Math.max(new Date(r.windowStart).getTime(), today + DAY);
    end = new Date(r.windowEnd).getTime();
  } else {
    if (!r.horizonDays) return 0;
    start = today + DAY;
    end = today + r.horizonDays * DAY;
  }
  if (end < start) return 0;
  const days = Math.round((end - start) / DAY) + 1;
  if (r.tripType === "one_way") return days;
  const min = r.minStayDays ?? 0;
  const max = r.maxStayDays ?? min;
  let n = 0;
  for (let d = 0; d < days; d++) {
    for (let s = min; s <= max; s++) {
      const ret = start + (d + s) * DAY;
      // rolling: a volta pode passar do horizonte; window: tem que caber
      if (r.dateMode === "window" && ret > end) break;
      n++;
    }
  }
  return n;
}

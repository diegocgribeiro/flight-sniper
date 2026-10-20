import { money } from "@/lib/format";

/** Gráfico SVG simples: menor preço de cada varredura vs. linha do preço alvo. */
export function PriceChart({
  data,
  target,
  currency,
}: {
  /** `label`: data/hora da varredura (DD/MM HH:MM, horário de São Paulo). */
  data: { at: string; label: string; price: number }[];
  target: number;
  currency: string;
}) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sem histórico ainda — aguarde a primeira varredura.</p>;
  }
  const W = 720;
  const H = 200;
  const P = { l: 56, r: 12, t: 12, b: 24 };
  const prices = data.map((d) => d.price);
  const lo = Math.min(...prices, target) * 0.95;
  const hi = Math.max(...prices, target) * 1.05;
  const x = (i: number) => P.l + (data.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (data.length - 1));
  const y = (v: number) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo || 1);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.price).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Histórico do menor preço por varredura">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {money(t, currency)}
          </text>
        </g>
      ))}
      <line
        x1={P.l}
        x2={W - P.r}
        y1={y(target)}
        y2={y(target)}
        stroke="var(--good)"
        strokeDasharray="5 4"
      />
      <text x={W - P.r} y={y(target) - 4} textAnchor="end" fontSize="11" fill="var(--good)">
        alvo
      </text>
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle
          key={d.at}
          cx={x(i)}
          cy={y(d.price)}
          r={data.length > 60 ? 2 : 3}
          fill={d.price < target ? "var(--good)" : "var(--brand)"}
        >
          <title>{`${d.label}: ${money(d.price, currency)}`}</title>
        </circle>
      ))}
      {[0, 1, 2, 3]
        .map((k) => Math.round((k * (data.length - 1)) / 3))
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((i, k, arr) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={arr.length > 1 && k === 0 ? "start" : arr.length > 1 && k === arr.length - 1 ? "end" : "middle"}
            fontSize="11"
            fill="var(--muted)"
          >
            {data[i].label}
          </text>
        ))}
    </svg>
  );
}

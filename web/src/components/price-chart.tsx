import { money } from "@/lib/format";

/** Gráfico SVG simples: menor preço por dia vs. linha do preço alvo. */
export function PriceChart({
  data,
  target,
  currency,
}: {
  data: { day: string; price: number }[];
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
  const fmtDay = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Histórico do menor preço por dia">
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
        <circle key={d.day} cx={x(i)} cy={y(d.price)} r="3" fill={d.price < target ? "var(--good)" : "var(--brand)"}>
          <title>{`${fmtDay(d.day)}: ${money(d.price, currency)}`}</title>
        </circle>
      ))}
      {[0, Math.floor((data.length - 1) / 2), data.length - 1]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {fmtDay(data[i].day)}
          </text>
        ))}
    </svg>
  );
}

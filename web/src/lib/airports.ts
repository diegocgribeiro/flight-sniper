import "server-only";
import raw from "@/data/airports.json";

/**
 * Busca de aeroportos por cidade, nome ou código IATA.
 * Base: OurAirports (domínio público), só aeroportos com voo comercial regular
 * e código IATA — gerada por scripts/build_airports.py.
 */

type Row = [iata: string, name: string, city: string, country: string, rank: number];

export type AirportHit = {
  /** Códigos a adicionar: 1 aeroporto ou todos os da cidade. */
  codes: string[];
  label: string;
  detail: string;
  kind: "airport" | "city";
};

type Airport = { iata: string; name: string; city: string; country: string; rank: number; key: string; nName: string };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Nomes em português → nome da cidade na base (inglês). */
const PT_ALIASES: Record<string, string> = {
  londres: "london",
  "nova york": "new york",
  "nova iorque": "new york",
  lisboa: "lisbon",
  roma: "rome",
  milao: "milan",
  munique: "munich",
  genebra: "geneva",
  zurique: "zurich",
  atenas: "athens",
  bruxelas: "brussels",
  viena: "vienna",
  praga: "prague",
  varsovia: "warsaw",
  copenhague: "copenhagen",
  estocolmo: "stockholm",
  moscou: "moscow",
  pequim: "beijing",
  xangai: "shanghai",
  toquio: "tokyo",
  seul: "seoul",
  cingapura: "singapore",
  "cidade do mexico": "mexico city",
  "cidade do cabo": "cape town",
  "cidade do panama": "panama city",
  "nova delhi": "new delhi",
  edimburgo: "edinburgh",
  florenca: "florence",
  veneza: "venice",
  napoles: "naples",
  sevilha: "seville",
  "sao francisco": "san francisco",
  assuncao: "asuncion",
  montevideu: "montevideo",
  istambul: "istanbul",
  berlim: "berlin",
  amsterda: "amsterdam",
  madri: "madrid",
  joanesburgo: "johannesburg",
  marraquexe: "marrakech",
  cairo: "cairo",
  havana: "havana",
  "las vegas": "las vegas",
  "nova orleans": "new orleans",
  filadelfia: "philadelphia",
  "buenos aires": "buenos aires",
};

const countryName = (() => {
  const dn = new Intl.DisplayNames(["pt-BR"], { type: "region" });
  const cache = new Map<string, string>();
  return (code: string) => {
    if (!cache.has(code)) {
      let name = code;
      try {
        name = dn.of(code) ?? code;
      } catch {
        // código de país fora do padrão: mantém a sigla
      }
      cache.set(code, name);
    }
    return cache.get(code)!;
  };
})();

const AIRPORTS: Airport[] = (raw as Row[]).map(([iata, name, city, country, rank]) => ({
  iata,
  name,
  city,
  country,
  rank,
  key: norm(city),
  nName: norm(name),
}));

const BY_CITY = new Map<string, Airport[]>();
for (const a of AIRPORTS) {
  const k = `${a.key}|${a.country}`;
  BY_CITY.set(k, [...(BY_CITY.get(k) ?? []), a]);
}

const BY_IATA = new Map(AIRPORTS.map((a) => [a.iata, a]));

export function isKnownAirport(code: string): boolean {
  return BY_IATA.has(code.toUpperCase());
}

export function searchAirports(query: string, limit = 8): AirportHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const alias = PT_ALIASES[q];
  const upper = query.trim().toUpperCase();

  const scored: { a: Airport; score: number }[] = [];
  for (const a of AIRPORTS) {
    let score = 0;
    if (a.iata === upper) score = 1000;
    else if (alias && a.key === alias) score = 600;
    else if (a.key === q) score = 500;
    else if (a.key.startsWith(q)) score = 300;
    else if (a.key.includes(q)) score = 150;
    else if (a.nName.includes(q)) score = 100;
    else if (alias && a.key.startsWith(alias)) score = 250;
    if (score) scored.push({ a, score: score + a.rank * 10 });
  }
  scored.sort((x, y) => y.score - x.score || x.a.iata.localeCompare(y.a.iata));

  const hits: AirportHit[] = [];
  const cityDone = new Set<string>();
  for (const { a } of scored) {
    // Cidade com vários aeroportos (São Paulo, Rio, Londres…): oferece "todos".
    const ck = `${a.key}|${a.country}`;
    const group = BY_CITY.get(ck) ?? [];
    if (group.length > 1 && !cityDone.has(ck) && a.iata !== upper) {
      cityDone.add(ck);
      const codes = [...group].sort((x, y) => y.rank - x.rank).slice(0, 5).map((g) => g.iata);
      hits.push({
        codes,
        label: `${a.city} — todos os aeroportos`,
        detail: `${codes.join(", ")} · ${countryName(a.country)}`,
        kind: "city",
      });
    }
    hits.push({
      codes: [a.iata],
      label: `${a.city || a.name} (${a.iata})`,
      detail: `${a.name} · ${countryName(a.country)}`,
      kind: "airport",
    });
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

/** Rótulo curto "Cidade (IATA)" para exibir códigos já escolhidos. */
export function describeAirports(codes: string[]): { code: string; city: string }[] {
  return codes.map((code) => ({ code, city: BY_IATA.get(code)?.city ?? "" }));
}

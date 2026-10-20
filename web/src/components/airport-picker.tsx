"use client";

import { useEffect, useId, useRef, useState } from "react";

type Hit = { codes: string[]; label: string; detail: string; kind: "airport" | "city" };

const MAX = 5;

/**
 * Campo de aeroportos com busca por cidade/nome/IATA. Os códigos escolhidos
 * viram "chips" e são enviados no input oculto `name` separados por vírgula.
 */
export function AirportPicker({
  name,
  value,
  onChange,
  labels,
  placeholder,
}: {
  name: string;
  value: string[];
  onChange: (codes: string[]) => void;
  /** Cidade de cada código já conhecido (para exibir nos chips). */
  labels: Record<string, string>;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [cities, setCities] = useState<Record<string, string>>(labels);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Resultados de uma busca anterior não valem para um texto curto demais.
  const hits = query.trim().length >= 2 ? results : [];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults(await res.json());
          setActive(0);
        }
      } catch {
        // busca cancelada por nova digitação
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const add = (hit: Hit) => {
    const next = [...value];
    for (const c of hit.codes) if (!next.includes(c) && next.length < MAX) next.push(c);
    onChange(next);
    if (hit.kind === "airport") {
      const city = hit.label.replace(/\s*\([A-Z]{3}\)$/, "");
      setCities((m) => ({ ...m, [hit.codes[0]]: city }));
    }
    setQuery("");
    setResults([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      if (hits[active] && query.trim()) {
        e.preventDefault();
        add(hits[active]);
      } else if (/^[A-Za-z]{3}$/.test(query.trim())) {
        e.preventDefault();
        add({ codes: [query.trim().toUpperCase()], label: query.trim().toUpperCase(), detail: "", kind: "airport" });
      } else if (e.key === "Enter") {
        e.preventDefault(); // não envia o formulário pela busca
      }
    } else if (e.key === "Backspace" && query === "" && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value={value.join(",")} />
      <div className="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5">
        {value.map((code) => (
          <span key={code} className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-sm">
            <b className="font-mono">{code}</b>
            {cities[code] && <span className="text-muted">{cities[code]}</span>}
            <button
              type="button"
              aria-label={`Remover ${code}`}
              className="ml-0.5 text-muted hover:text-bad"
              onClick={() => onChange(value.filter((c) => c !== code))}
            >
              ×
            </button>
          </span>
        ))}
        {value.length < MAX && (
          <input
            className="min-w-[8rem] flex-1 bg-transparent outline-none"
            value={query}
            placeholder={value.length ? "" : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            role="combobox"
            aria-controls={listId}
            aria-expanded={open && hits.length > 0}
          />
        )}
      </div>
      {open && hits.length > 0 && (
        <ul id={listId} className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-panel py-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.codes.join()}`}>
              <button
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm ${i === active ? "bg-brand/10" : "hover:bg-bg"}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(h)}
              >
                <div className="font-medium">
                  {h.kind === "city" ? "🏙 " : "✈ "}
                  {h.label}
                </div>
                <div className="truncate text-xs text-muted">{h.detail}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

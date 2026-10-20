"""Gera src/data/airports.json a partir do airports.csv do OurAirports.

Uso: python scripts/build_airports.py airports.csv src/data/airports.json
Fonte: https://davidmegginson.github.io/ourairports-data/airports.csv (domínio público).
"""
import csv, json, sys
src, dst = sys.argv[1], sys.argv[2]
RANK = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
out, seen = [], set()
with open(src, encoding="utf-8") as f:
    for r in csv.DictReader(f):
        iata = (r["iata_code"] or "").strip().upper()
        if len(iata) != 3 or not iata.isalpha() or iata in seen:
            continue
        if r["scheduled_service"] != "yes" or r["type"] not in RANK:
            continue
        seen.add(iata)
        out.append([iata, r["name"].strip(), (r["municipality"] or "").strip(), r["iso_country"], RANK[r["type"]]])
out.sort(key=lambda a: (-a[4], a[0]))
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(out), "aeroportos")

"""Busca de preços no Google Flights via ``fast-flights``."""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Any

from fast_flights import (
    FlightQuery,
    FlightsNotFound,
    Passengers,
    create_query,
    fetch_flights_html,
    get_flights,
)

from .models import Combo, Offer, Route
from .tolerant_parser import parse_html

logger = logging.getLogger(__name__)

RETRY_BACKOFF_SECONDS = (3.0, 8.0)


class SearchError(RuntimeError):
    """Falha ao buscar (rede, bloqueio ou HTML inesperado) após as retentativas."""


def build_query(route: Route, combo: Combo) -> Any:
    """Monta a query protobuf do Google Flights para uma combinação."""
    legs = [FlightQuery(date=combo.dates.depart, from_airport=combo.origin, to_airport=combo.destination)]
    if combo.dates.ret is not None:
        legs.append(
            FlightQuery(date=combo.dates.ret, from_airport=combo.destination, to_airport=combo.origin)
        )
    return create_query(
        flights=legs,
        trip="round-trip" if combo.dates.ret is not None else "one-way",
        seat=route.cabin,  # type: ignore[arg-type]
        passengers=Passengers(adults=route.adults),
        language="pt-BR",
        currency=route.currency,
        max_stops=route.max_stops,
    )


def _segments_to_json(flight: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for seg in flight.flights:
        dy, dm, dd = seg.departure.date
        ay, am, ad = seg.arrival.date
        out.append(
            {
                "from": seg.from_airport.code,
                "to": seg.to_airport.code,
                "dep": f"{dy:04d}-{dm:02d}-{dd:02d}T{seg.departure.time[0]:02d}:{seg.departure.time[1]:02d}",
                "arr": f"{ay:04d}-{am:02d}-{ad:02d}T{seg.arrival.time[0]:02d}:{seg.arrival.time[1]:02d}",
                "duration": seg.duration,
                "plane": seg.plane_type,
            }
        )
    return out


def search_combo(route: Route, combo: Combo) -> Offer | None:
    """Busca uma combinação e devolve a oferta mais barata.

    Para ida e volta o Google retorna as opções de ida com o preço **total**
    da viagem; as paradas/duração referem-se ao trecho de ida.

    Args:
        route: Rota (filtros de cabine, passageiros, paradas, moeda).
        combo: Aeroportos e datas.

    Returns:
        A melhor oferta, ou ``None`` quando não há voos.

    Raises:
        SearchError: Se todas as tentativas falharem.
    """
    query = build_query(route, combo)
    last_exc: Exception | None = None
    for attempt in range(len(RETRY_BACKOFF_SECONDS) + 1):
        try:
            results = get_flights(query)
            break
        except FlightsNotFound:
            return None
        except (IndexError, KeyError, TypeError) as exc:
            # Payload com algum itinerário incompleto: relê ignorando só os malformados.
            logger.info("Parser padrão falhou em %s (%s); usando parser tolerante", combo, exc)
            try:
                results = parse_html(fetch_flights_html(query))
                break
            except FlightsNotFound:
                return None
            except Exception as exc2:
                last_exc = exc2
                if attempt < len(RETRY_BACKOFF_SECONDS):
                    time.sleep(RETRY_BACKOFF_SECONDS[attempt])
        except Exception as exc:  # rede, bloqueio, mudança no HTML
            last_exc = exc
            if attempt < len(RETRY_BACKOFF_SECONDS):
                wait = RETRY_BACKOFF_SECONDS[attempt]
                logger.warning(
                    "Falha em %s (tentativa %d): %s — nova tentativa em %.0fs", combo, attempt + 1, exc, wait
                )
                time.sleep(wait)
    else:
        raise SearchError(f"{combo}: {last_exc}") from last_exc

    priced = [f for f in results if f.price and f.price > 0]
    if route.max_stops is not None:
        priced = [f for f in priced if len(f.flights) - 1 <= route.max_stops]
    if not priced:
        return None

    best = min(priced, key=lambda f: f.price)
    return Offer(
        combo=combo,
        price=Decimal(best.price),
        currency=route.currency,
        airlines=list(best.airlines),
        stops=max(0, len(best.flights) - 1),
        duration_minutes=sum(s.duration or 0 for s in best.flights) or None,
        url=query.url(),
        legs=_segments_to_json(best),
    )

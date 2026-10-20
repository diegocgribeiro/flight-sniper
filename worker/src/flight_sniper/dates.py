"""Geração das combinações de datas/aeroportos de uma rota."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import date, timedelta
from typing import TypeVar

from .models import Combo, Route, TripDates

logger = logging.getLogger(__name__)

T = TypeVar("T")


def _days(start: date, end: date) -> Iterator[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def trip_dates(route: Route, today: date) -> list[TripDates]:
    """Lista as combinações de ida/volta válidas para a rota.

    Regras:
        * ``fixed``: exatamente as datas cadastradas (ignora se a ida já passou).
        * ``window``: ida e volta dentro de ``[window_start, window_end]``; a viagem não
          precisa ocupar o período inteiro, só caber nele com duração entre min/max.
        * ``rolling``: ida entre amanhã e ``today + horizon_days``; a volta pode
          ultrapassar o horizonte (o que importa é quando se parte).

    Args:
        route: Rota a expandir.
        today: Data local de referência; nunca se busca voo para hoje ou antes.

    Returns:
        Combinações ordenadas por (ida, volta).
    """
    earliest = today + timedelta(days=1)
    round_trip = route.trip_type == "round_trip"

    if route.date_mode == "fixed":
        if route.depart_date is None or route.depart_date < earliest:
            return []
        return [TripDates(route.depart_date, route.return_date if round_trip else None)]

    if route.date_mode == "window":
        if route.window_start is None or route.window_end is None:
            return []
        start, end, return_limit = max(route.window_start, earliest), route.window_end, route.window_end
    elif route.date_mode == "rolling":
        if not route.horizon_days:
            return []
        start, end, return_limit = earliest, today + timedelta(days=route.horizon_days), None
    else:  # pragma: no cover - enum do banco
        raise ValueError(f"date_mode desconhecido: {route.date_mode}")

    if end < start:
        return []

    if not round_trip:
        return [TripDates(d) for d in _days(start, end)]

    min_stay = route.min_stay_days or 0
    max_stay = route.max_stay_days if route.max_stay_days is not None else min_stay
    result: list[TripDates] = []
    for depart in _days(start, end):
        for stay in range(min_stay, max_stay + 1):
            ret = depart + timedelta(days=stay)
            if return_limit is not None and ret > return_limit:
                break
            result.append(TripDates(depart, ret))
    return result


def all_combos(route: Route, today: date) -> list[Combo]:
    """Produto cartesiano origens × destinos × datas, em ordem determinística."""
    dates = trip_dates(route, today)
    return [Combo(o, d, td) for td in dates for o in route.origins for d in route.destinations if o != d]


def _spread(items: list[T], k: int) -> list[T]:
    """Escolhe ``k`` itens distribuídos uniformemente (inclui as pontas)."""
    n = len(items)
    if k >= n:
        return list(items)
    if k <= 0:
        return []
    if k == 1:
        return [items[n // 2]]
    return [items[round(i * (n - 1) / (k - 1))] for i in range(k)]


def sample_combos(route: Route, today: date, budget: int) -> tuple[list[Combo], int]:
    """Combinações desta execução, limitadas a ``budget`` buscas.

    Quando o total cabe no orçamento, busca tudo. Caso contrário monta uma amostra
    representativa em vez de varrer só o começo do período:

    * as datas de ida são espalhadas uniformemente pelo período inteiro (o passo
      fracionário alterna os dias da semana);
    * cada ida recebe uma duração, alternando entre mín. e máx., para que todas
      as durações apareçam ao longo do período;
    * a mesma grade de datas é usada para cada par de aeroportos.

    Assim uma única execução já dá a estimativa de preço do período todo.

    Args:
        route: Rota a expandir.
        today: Data local de referência.
        budget: Máximo de buscas permitidas nesta execução.

    Returns:
        Tupla (combinações a buscar, total de combinações possíveis).
    """
    pairs = [(o, d) for o in route.origins for d in route.destinations if o != d]
    dates = trip_dates(route, today)
    total = len(dates) * len(pairs)
    if total <= budget:
        return [Combo(o, d, td) for td in dates for o, d in pairs], total
    if not pairs:
        return [], 0

    per_pair = max(1, budget // len(pairs))
    by_depart: dict[date, list[TripDates]] = {}
    for td in dates:
        by_depart.setdefault(td.depart, []).append(td)
    departs = sorted(by_depart)

    chosen: list[TripDates] = []
    if len(departs) >= per_pair:
        for i, dep in enumerate(_spread(departs, per_pair)):
            options = by_depart[dep]
            chosen.append(options[i % len(options)])
    else:
        # Poucas idas e muitas durações: várias durações por ida, também espalhadas.
        per_depart = per_pair // len(departs)
        extra = per_pair % len(departs)
        for i, dep in enumerate(departs):
            chosen.extend(_spread(by_depart[dep], per_depart + (1 if i < extra else 0)))

    combos = [Combo(o, d, td) for td in sorted(chosen) for o, d in pairs]
    return combos[:budget], total

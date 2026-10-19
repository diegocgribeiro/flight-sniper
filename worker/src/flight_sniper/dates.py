"""Geração das combinações de datas/aeroportos de uma rota."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import date, timedelta

from .models import Combo, Route, TripDates

logger = logging.getLogger(__name__)


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


def select_batch(combos: list[Combo], cursor: int, budget: int) -> tuple[list[Combo], int]:
    """Seleciona a fatia desta execução numa janela rotativa.

    Quando há mais combinações que o orçamento, cada execução cobre a próxima
    fatia e o cursor avança; após N/budget execuções tudo foi visto uma vez.

    Args:
        combos: Todas as combinações (ordem estável).
        cursor: Posição salva da execução anterior.
        budget: Máximo de buscas permitidas nesta execução.

    Returns:
        Tupla (fatia a buscar, novo cursor).
    """
    n = len(combos)
    if n == 0:
        return [], 0
    if n <= budget:
        return list(combos), 0
    start = cursor % n
    batch = [combos[(start + i) % n] for i in range(budget)]
    return batch, (start + budget) % n

"""Tipos de domínio do worker."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

TripType = Literal["one_way", "round_trip"]
DateMode = Literal["fixed", "window", "rolling"]


@dataclass(frozen=True)
class ScheduleRule:
    """Faixa horária local ``[start, end)`` com intervalo de checagem em horas."""

    start: int
    end: int
    every: int


@dataclass(frozen=True)
class Route:
    """Rota monitorada (espelho da tabela ``routes``)."""

    id: int
    name: str
    origins: list[str]
    destinations: list[str]
    trip_type: TripType
    date_mode: DateMode
    depart_date: date | None
    return_date: date | None
    window_start: date | None
    window_end: date | None
    horizon_days: int | None
    min_stay_days: int | None
    max_stay_days: int | None
    target_price: Decimal
    currency: str
    adults: int
    cabin: str
    max_stops: int | None
    schedule: list[ScheduleRule]
    max_queries_per_run: int
    notify_email: str | None
    cursor: int
    last_checked_at: datetime | None


@dataclass(frozen=True, order=True)
class TripDates:
    """Par de datas de uma combinação (``ret`` é ``None`` para só ida)."""

    depart: date
    ret: date | None = None


@dataclass(frozen=True, order=True)
class Combo:
    """Uma busca concreta: aeroportos + datas."""

    origin: str
    destination: str
    dates: TripDates


@dataclass
class Offer:
    """Melhor oferta encontrada para uma combinação."""

    combo: Combo
    price: Decimal
    currency: str
    airlines: list[str]
    stops: int
    duration_minutes: int | None
    url: str
    legs: list[dict[str, Any]] = field(default_factory=list)

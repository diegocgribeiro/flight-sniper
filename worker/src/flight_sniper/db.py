"""Acesso ao Postgres (Neon). O schema é mantido pelas migrations do Drizzle em ``web/drizzle``."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import Offer, Route, ScheduleRule

logger = logging.getLogger(__name__)


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    """Abre conexão com autocommit (cada escrita é independente e idempotente)."""
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as conn:
        yield conn


def _route_from_row(row: dict[str, Any]) -> Route:
    return Route(
        id=row["id"],
        name=row["name"],
        origins=list(row["origins"]),
        destinations=list(row["destinations"]),
        trip_type=row["trip_type"],
        date_mode=row["date_mode"],
        depart_date=row["depart_date"],
        return_date=row["return_date"],
        window_start=row["window_start"],
        window_end=row["window_end"],
        horizon_days=row["horizon_days"],
        min_stay_days=row["min_stay_days"],
        max_stay_days=row["max_stay_days"],
        target_price=Decimal(row["target_price"]),
        currency=row["currency"],
        adults=row["adults"],
        cabin=row["cabin"],
        max_stops=row["max_stops"],
        schedule=[ScheduleRule(int(r["from"]), int(r["to"]), int(r["every"])) for r in row["schedule"]],
        max_queries_per_run=row["max_queries_per_run"],
        notify_email=row["notify_email"],
        ntfy_topic=row["ntfy_topic"],
        alert_floor=None if row["alert_floor"] is None else Decimal(row["alert_floor"]),
        cursor=row["cursor"],
        last_checked_at=row["last_checked_at"],
    )


def fetch_routes(conn: psycopg.Connection[dict[str, Any]], route_id: int | None = None) -> list[Route]:
    """Rotas ativas (ou uma rota específica, mesmo pausada, quando ``route_id`` é dado)."""
    if route_id is not None:
        rows = conn.execute("select * from routes where id = %s", (route_id,)).fetchall()
    else:
        rows = conn.execute("select * from routes where active order by id").fetchall()
    return [_route_from_row(r) for r in rows]


def start_run(conn: psycopg.Connection[dict[str, Any]], trigger: str) -> UUID:
    row = conn.execute("insert into runs (trigger) values (%s) returning id", (trigger,)).fetchone()
    assert row is not None
    return row["id"]


def finish_run(
    conn: psycopg.Connection[dict[str, Any]],
    run_id: UUID,
    *,
    routes_checked: int,
    queries: int,
    errors: int,
    alerts_sent: int,
    status: str,
    message: str | None,
) -> None:
    conn.execute(
        """update runs set finished_at = now(), routes_checked = %s, queries = %s, errors = %s,
                  alerts_sent = %s, status = %s, message = %s where id = %s""",
        (routes_checked, queries, errors, alerts_sent, status, message, run_id),
    )


def insert_offers(
    conn: psycopg.Connection[dict[str, Any]], route_id: int, run_id: UUID, offers: list[Offer]
) -> None:
    if not offers:
        return
    with conn.cursor() as cur:
        cur.executemany(
            """insert into price_checks (route_id, run_id, origin, destination, depart_date, return_date,
                   price, currency, airlines, stops, duration_minutes, legs, url)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [
                (
                    route_id,
                    run_id,
                    o.combo.origin,
                    o.combo.destination,
                    o.combo.dates.depart,
                    o.combo.dates.ret,
                    o.price,
                    o.currency,
                    o.airlines,
                    o.stops,
                    o.duration_minutes,
                    Jsonb(o.legs),
                    o.url,
                )
                for o in offers
            ],
        )


def mark_checked(
    conn: psycopg.Connection[dict[str, Any]], route_id: int, cursor: int, checked_at: datetime
) -> None:
    conn.execute(
        "update routes set cursor = %s, last_checked_at = %s where id = %s", (cursor, checked_at, route_id)
    )


def set_alert_floor(conn: psycopg.Connection[dict[str, Any]], route_id: int, floor: Decimal | None) -> None:
    """Grava o piso do episódio de alerta (``None`` encerra o episódio)."""
    conn.execute("update routes set alert_floor = %s where id = %s", (floor, route_id))


def insert_alert(
    conn: psycopg.Connection[dict[str, Any]],
    route_id: int,
    run_id: UUID,
    offer: Offer,
    email_to: str,
    provider_id: str | None,
    ntfy_topic: str | None,
) -> None:
    conn.execute(
        """insert into alerts (route_id, run_id, best_price, depart_date, return_date, email_to, provider_id,
                               ntfy_topic)
           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            route_id,
            run_id,
            offer.price,
            offer.combo.dates.depart,
            offer.combo.dates.ret,
            email_to,
            provider_id,
            ntfy_topic,
        ),
    )


def prune_old_checks(conn: psycopg.Connection[dict[str, Any]], keep_days: int = 90) -> int:
    """Remove histórico antigo para caber no tier gratuito do Neon (0,5 GB)."""
    cur = conn.execute(
        "delete from price_checks where checked_at < now() - make_interval(days => %s)", (keep_days,)
    )
    return cur.rowcount

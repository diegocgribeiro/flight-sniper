"""Ponto de entrada: varre as rotas que estão na vez, grava preços e alerta.

Uso:
    python -m flight_sniper.main                 # execução agendada
    python -m flight_sniper.main --route-id 3 --force
    python -m flight_sniper.main --dry-run       # não grava nem envia e-mail
"""

from __future__ import annotations

import argparse
import logging
import random
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg

from . import db
from .alerts import render_email, send_email, should_alert
from .config import Settings
from .dates import all_combos, select_batch
from .models import Offer, Route
from .schedule import is_due
from .search import SearchError, search_combo

logger = logging.getLogger("flight_sniper")

ALERT_TOP_N = 5


@dataclass
class RouteResult:
    queries: int = 0
    errors: int = 0
    alert_sent: bool = False
    aborted: bool = False


def process_route(
    conn: psycopg.Connection[dict[str, Any]] | None,
    settings: Settings,
    route: Route,
    run_id: UUID | None,
    now: datetime,
) -> RouteResult:
    """Busca a fatia da vez de uma rota, persiste e decide o alerta.

    Idempotência: cada execução só insere observações novas (append-only) e
    o alerta é deduplicado pelo histórico em ``alerts``; reexecutar não duplica e-mails.
    """
    result = RouteResult()
    today = now.astimezone(settings.timezone).date()
    combos = all_combos(route, today)
    batch, next_cursor = select_batch(combos, route.cursor, route.max_queries_per_run)
    logger.info(
        "Rota #%d '%s': %d combinações, buscando %d (cursor %d→%d)",
        route.id,
        route.name,
        len(combos),
        len(batch),
        route.cursor,
        next_cursor,
    )
    if not batch:
        logger.warning("Rota #%d sem datas válidas (período no passado?)", route.id)

    offers: list[Offer] = []
    consecutive_errors = 0
    for i, combo in enumerate(batch):
        if i:
            time.sleep(settings.request_delay_seconds + random.uniform(0, 0.75))
        result.queries += 1
        try:
            offer = search_combo(route, combo)
            consecutive_errors = 0
        except SearchError as exc:
            result.errors += 1
            consecutive_errors += 1
            logger.error("Erro na busca: %s", exc)
            if consecutive_errors >= settings.max_consecutive_errors:
                logger.error(
                    "Rota #%d: %d erros seguidos, abortando (possível bloqueio)", route.id, consecutive_errors
                )
                result.aborted = True
                break
            continue
        if offer:
            offers.append(offer)
            logger.info(
                "  %s→%s %s%s: %s %s",
                combo.origin,
                combo.destination,
                combo.dates.depart,
                f" / {combo.dates.ret}" if combo.dates.ret else "",
                offer.currency,
                offer.price,
            )

    if conn is None or run_id is None:  # dry-run
        below = sorted((o for o in offers if o.price < route.target_price), key=lambda o: o.price)
        logger.info("[dry-run] %d ofertas, %d abaixo da meta", len(offers), len(below))
        return result

    db.insert_offers(conn, route.id, run_id, offers)
    # Se abortou, não avança o cursor: a fatia será retentada na próxima execução.
    db.mark_checked(conn, route.id, route.cursor if result.aborted else next_cursor, now)

    below = sorted((o for o in offers if o.price < route.target_price), key=lambda o: o.price)
    if not below:
        return result

    best = below[0]
    recent = db.recent_alert_min_price(conn, route.id, timedelta(hours=settings.alert_cooldown_hours))
    if not should_alert(best.price, route.target_price, recent):
        logger.info(
            "Rota #%d: %s abaixo da meta, mas já alertado (mín. recente %s)", route.id, best.price, recent
        )
        return result

    to = route.notify_email or settings.alert_email
    if not settings.resend_api_key or not to:
        logger.warning("Alerta não enviado: RESEND_API_KEY ou e-mail de destino ausente")
        return result

    subject, body = render_email(route, below[:ALERT_TOP_N], settings.app_url)
    try:
        provider_id = send_email(settings.resend_api_key, settings.resend_from, to, subject, body)
    except RuntimeError as exc:
        logger.error("Falha ao enviar e-mail: %s", exc)
        result.errors += 1
        return result
    db.insert_alert(conn, route.id, run_id, best, to, provider_id)
    result.alert_sent = True
    logger.info("Alerta enviado para rota #%d: %s", route.id, best.price)
    return result


def run(route_id: int | None, force: bool, dry_run: bool, trigger: str) -> int:
    """Executa uma varredura completa. Retorna o exit code."""
    settings = Settings.from_env()
    now = datetime.now(UTC)

    with db.connect(settings.database_url) as conn:
        routes = db.fetch_routes(conn, route_id)
        due = [r for r in routes if force or is_due(r.schedule, r.last_checked_at, now, settings.timezone)]
        logger.info("%d rota(s) carregada(s), %d na vez", len(routes), len(due))
        if not due:
            return 0

        run_id = None if dry_run else db.start_run(conn, trigger)
        totals = RouteResult()
        checked = alerts = 0
        failures: list[str] = []
        for route in due:
            try:
                res = process_route(None if dry_run else conn, settings, route, run_id, now)
            except Exception as exc:  # uma rota com problema não derruba as demais
                logger.exception("Falha inesperada na rota #%d", route.id)
                failures.append(f"#{route.id}: {exc}")
                totals.errors += 1
                continue
            checked += 1
            totals.queries += res.queries
            totals.errors += res.errors
            alerts += int(res.alert_sent)
            if res.aborted:
                failures.append(f"#{route.id}: abortada por erros seguidos")

        if run_id is not None:
            status = "ok" if not failures and totals.errors == 0 else ("partial" if checked else "failed")
            db.finish_run(
                conn,
                run_id,
                routes_checked=checked,
                queries=totals.queries,
                errors=totals.errors,
                alerts_sent=alerts,
                status=status,
                message="; ".join(failures)[:1000] or None,
            )
            pruned = db.prune_old_checks(conn)
            if pruned:
                logger.info("%d observações antigas removidas", pruned)

        logger.info(
            "Fim: %d rotas, %d buscas, %d erros, %d alertas", checked, totals.queries, totals.errors, alerts
        )
        return 1 if checked == 0 and failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Flight Sniper worker")
    parser.add_argument("--route-id", type=int, default=None, help="Processa só esta rota")
    parser.add_argument("--force", action="store_true", help="Ignora a agenda de horários")
    parser.add_argument("--dry-run", action="store_true", help="Não grava no banco nem envia e-mail")
    parser.add_argument("--trigger", default="schedule", help="Rótulo da execução (schedule/manual)")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout
    )
    return run(args.route_id, args.force, args.dry_run, args.trigger)


if __name__ == "__main__":
    raise SystemExit(main())

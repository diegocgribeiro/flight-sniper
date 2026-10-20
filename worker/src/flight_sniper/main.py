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
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg

from . import db
from .alerts import decide_alert, render_email, render_push, send_email, send_ntfy
from .config import Settings
from .dates import sample_combos
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
    """Busca a amostra de combinações de uma rota, persiste e decide o alerta.

    Idempotência: cada execução só insere observações novas (append-only) e o
    alerta depende do piso do episódio gravado em ``routes.alert_floor``;
    reexecutar com o mesmo preço não reenvia notificação.
    """
    result = RouteResult()
    today = now.astimezone(settings.timezone).date()
    batch, total = sample_combos(route, today, route.max_queries_per_run)
    logger.info(
        "Rota #%d '%s': %d combinações possíveis, buscando %d", route.id, route.name, total, len(batch)
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
    db.mark_checked(conn, route.id, 0, now)

    below = sorted((o for o in offers if o.price < route.target_price), key=lambda o: o.price)
    best_price = min((o.price for o in offers), default=None)
    decision = decide_alert(
        best_price,
        route.target_price,
        route.alert_floor,
        complete=not result.aborted and result.errors == 0,
    )
    if not decision.send:
        if decision.floor != route.alert_floor:
            db.set_alert_floor(conn, route.id, decision.floor)
            logger.info("Rota #%d: preço voltou acima da meta, próximo recuo abaixo dela alerta", route.id)
        elif below:
            logger.info(
                "Rota #%d: %s abaixo da meta, mas não menor que o já alertado (%s)",
                route.id,
                below[0].price,
                route.alert_floor,
            )
        return result

    if notify(settings, route, below[:ALERT_TOP_N], run_id, conn):
        db.set_alert_floor(conn, route.id, decision.floor)
        result.alert_sent = True
    else:
        result.errors += 1
    return result


def notify(
    settings: Settings,
    route: Route,
    offers: list[Offer],
    run_id: UUID,
    conn: psycopg.Connection[dict[str, Any]],
) -> bool:
    """Envia o alerta por e-mail (obrigatório) e ntfy (opcional).

    Os canais são independentes: a falha de um não impede o outro.

    Returns:
        True se ao menos um canal entregou (o piso do episódio só avança nesse caso,
        senão o mesmo preço seria tentado de novo na próxima execução).
    """
    best = offers[0]
    to = route.notify_email or settings.alert_email
    provider_id: str | None = None
    email_ok = ntfy_ok = False

    if settings.resend_api_key and to:
        subject, body = render_email(route, offers, settings.app_url)
        try:
            provider_id = send_email(settings.resend_api_key, settings.resend_from, to, subject, body)
            email_ok = True
        except (RuntimeError, OSError) as exc:
            logger.error("Falha ao enviar e-mail da rota #%d: %s", route.id, exc)
    else:
        logger.warning("E-mail não enviado: RESEND_API_KEY ou destinatário ausente")

    if route.ntfy_topic:
        try:
            send_ntfy(settings.ntfy_server, route.ntfy_topic, render_push(route, offers, settings.app_url))
            ntfy_ok = True
        except RuntimeError as exc:
            logger.error("Falha ao publicar no ntfy da rota #%d: %s", route.id, exc)

    if not (email_ok or ntfy_ok):
        return False
    db.insert_alert(
        conn,
        route.id,
        run_id,
        best,
        to if email_ok else "",
        provider_id,
        route.ntfy_topic if ntfy_ok else None,
    )
    logger.info("Alerta da rota #%d: %s (e-mail=%s, ntfy=%s)", route.id, best.price, email_ok, ntfy_ok)
    return True


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
    logging.getLogger("primp").setLevel(logging.WARNING)  # loga a URL de cada request
    return run(args.route_id, args.force, args.dry_run, args.trigger)


if __name__ == "__main__":
    raise SystemExit(main())

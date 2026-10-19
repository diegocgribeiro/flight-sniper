"""Decide se uma rota está "na vez" de ser checada."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .models import ScheduleRule

# O cron do GitHub Actions costuma atrasar alguns minutos; sem tolerância uma
# rota "a cada 1h" pularia execuções quando o disparo anterior atrasou.
DEFAULT_TOLERANCE = timedelta(minutes=15)


def interval_for(rules: list[ScheduleRule], local_hour: int) -> int | None:
    """Intervalo (h) da faixa que contém ``local_hour``; ``None`` se fora de todas."""
    for rule in rules:
        if rule.start <= local_hour < rule.end:
            return rule.every
    return None


def is_due(
    rules: list[ScheduleRule],
    last_checked_at: datetime | None,
    now: datetime,
    tz: ZoneInfo,
    tolerance: timedelta = DEFAULT_TOLERANCE,
) -> bool:
    """Retorna True se a rota deve ser checada agora.

    Args:
        rules: Faixas horárias da rota.
        last_checked_at: Última checagem (timezone-aware) ou None.
        now: Instante atual (timezone-aware).
        tz: Fuso das faixas.
        tolerance: Folga para atrasos do agendador.
    """
    every = interval_for(rules, now.astimezone(tz).hour)
    if every is None:
        return False
    if last_checked_at is None:
        return True
    return now - last_checked_at >= timedelta(hours=every) - tolerance

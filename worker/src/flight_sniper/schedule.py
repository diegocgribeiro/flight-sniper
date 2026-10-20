"""Decide se uma rota está "na vez" de ser checada.

As faixas definem horários fixos de relógio (fuso local): "a cada 2h das 6h às 24h"
significa 6h, 8h, 10h, … A rota está na vez quando ainda não foi checada dentro do
horário atual. Assim um disparo atrasado não empurra os seguintes (sem deriva) e
disparos repetidos no mesmo horário não duplicam buscas.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .models import ScheduleRule

# Um disparo que chega alguns minutos antes da virada do horário (relógio do
# agendador adiantado) já conta para o horário seguinte.
DEFAULT_LEAD = timedelta(minutes=5)


def interval_for(rules: list[ScheduleRule], local_hour: int) -> int | None:
    """Intervalo (h) da faixa que contém ``local_hour``; ``None`` se fora de todas."""
    rule = _rule_for(rules, local_hour)
    return None if rule is None else rule.every


def _rule_for(rules: list[ScheduleRule], local_hour: int) -> ScheduleRule | None:
    for rule in rules:
        if rule.start <= local_hour < rule.end:
            return rule
    return None


def slot_start(
    rules: list[ScheduleRule], now: datetime, tz: ZoneInfo, lead: timedelta = DEFAULT_LEAD
) -> datetime | None:
    """Início do horário agendado vigente (timezone-aware) ou ``None`` fora das faixas.

    Args:
        rules: Faixas horárias da rota.
        now: Instante atual (timezone-aware).
        tz: Fuso das faixas.
        lead: Antecipação tolerada do disparo.
    """
    local = (now + lead).astimezone(tz)
    rule = _rule_for(rules, local.hour)
    if rule is None:
        return None
    hour = rule.start + (local.hour - rule.start) // rule.every * rule.every
    return local.replace(hour=hour, minute=0, second=0, microsecond=0)


def is_due(
    rules: list[ScheduleRule],
    last_checked_at: datetime | None,
    now: datetime,
    tz: ZoneInfo,
    lead: timedelta = DEFAULT_LEAD,
) -> bool:
    """Retorna True se a rota ainda não foi checada no horário agendado vigente.

    Args:
        rules: Faixas horárias da rota.
        last_checked_at: Última checagem (timezone-aware) ou None.
        now: Instante atual (timezone-aware).
        tz: Fuso das faixas.
        lead: Antecipação tolerada do disparo.
    """
    slot = slot_start(rules, now, tz, lead)
    if slot is None:
        return False
    return last_checked_at is None or last_checked_at < slot - lead

"""Configuração do worker via variáveis de ambiente."""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Variável de ambiente obrigatória ausente: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    """Parâmetros de execução do worker.

    Attributes:
        database_url: Connection string do Neon (Postgres).
        resend_api_key: Chave da API do Resend (vazia desativa o envio).
        resend_from: Remetente. Sem domínio verificado, use ``onboarding@resend.dev``.
        alert_email: Destinatário padrão quando a rota não define um.
        app_url: URL pública do site, usada nos links do e-mail.
        timezone: Fuso usado para interpretar as faixas de horário das rotas.
        request_delay_seconds: Pausa entre buscas para não ser bloqueado.
        ntfy_server: Servidor ntfy (público por padrão).
        max_consecutive_errors: Aborta a rota após N falhas seguidas (provável bloqueio).
    """

    database_url: str
    resend_api_key: str
    resend_from: str
    alert_email: str
    app_url: str
    timezone: ZoneInfo
    request_delay_seconds: float
    ntfy_server: str
    max_consecutive_errors: int

    @classmethod
    def from_env(cls) -> Settings:
        """Carrega as configurações do ambiente."""
        return cls(
            database_url=_required("DATABASE_URL"),
            resend_api_key=os.environ.get("RESEND_API_KEY", "").strip(),
            resend_from=os.environ.get("RESEND_FROM", "Flight Sniper <onboarding@resend.dev>").strip(),
            alert_email=os.environ.get("ALERT_EMAIL", "").strip(),
            app_url=os.environ.get("APP_URL", "").strip().rstrip("/"),
            timezone=ZoneInfo(os.environ.get("APP_TIMEZONE", "America/Sao_Paulo")),
            request_delay_seconds=float(os.environ.get("REQUEST_DELAY_SECONDS", "1.5")),
            ntfy_server=os.environ.get("NTFY_SERVER", "https://ntfy.sh").strip(),
            max_consecutive_errors=int(os.environ.get("MAX_CONSECUTIVE_ERRORS", "5")),
        )

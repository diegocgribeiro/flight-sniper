"""Regra de alerta e envio de e-mail pelo Resend."""

from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .models import Offer, Route

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
USER_AGENT = "flight-sniper/0.2"
WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


@dataclass(frozen=True)
class AlertDecision:
    """Resultado da regra de alerta.

    Attributes:
        send: Se a notificação deve ser enviada agora.
        floor: Novo "piso" do episódio (menor preço já alertado enquanto o
            preço segue abaixo da meta). ``None`` encerra o episódio.
    """

    send: bool
    floor: Decimal | None


def decide_alert(
    best_price: Decimal | None, target: Decimal, floor: Decimal | None, *, complete: bool
) -> AlertDecision:
    """Decide se alerta, tratando cada período abaixo da meta como um "episódio".

    Regras:
        * acima (ou igual) da meta: não alerta e encerra o episódio, então a
          próxima vez que cair abaixo da meta alerta de novo;
        * abaixo da meta, primeira vez no episódio: alerta;
        * abaixo da meta e menor que o último alertado: alerta (nova queda);
        * abaixo da meta, igual ou maior que o último alertado: não reenvia.

    Args:
        best_price: Menor preço da execução (``None`` se não houve resultado).
        target: Preço alvo da rota.
        floor: Piso do episódio atual (``None`` = fora de episódio).
        complete: Se a varredura cobriu todas as combinações sem erro. Uma
            varredura incompleta nunca encerra o episódio (o preço baixo pode
            só não ter sido consultado).
    """
    if best_price is None:
        return AlertDecision(False, floor if not complete else None)
    if best_price >= target:
        return AlertDecision(False, None if complete else floor)
    if floor is None or best_price < floor:
        return AlertDecision(True, best_price)
    return AlertDecision(False, floor)


def _money(v: Decimal, currency: str) -> str:
    if currency == "BRL":
        s = f"{v:,.0f}".replace(",", ".")
        return f"R$ {s}"
    return f"{currency} {v:,.0f}"


def _d(d: date) -> str:
    return f"{WEEKDAYS[d.weekday()]} {d:%d/%m}"


def render_email(route: Route, offers: list[Offer], app_url: str) -> tuple[str, str]:
    """Monta (assunto, html) com as melhores ofertas abaixo da meta."""
    best = offers[0]
    rt = best.combo.dates.ret is not None
    arrow = "⇄" if rt else "→"
    subject = (
        f"✈ {_money(best.price, best.currency)} {best.combo.origin}{arrow}{best.combo.destination} "
        f"({_d(best.combo.dates.depart)}{' – ' + _d(best.combo.dates.ret) if rt else ''}) — abaixo da meta"
    )
    rows = "".join(
        f"""<tr>
          <td style="padding:8px;border-top:1px solid #e2e8f0;font-family:monospace">{o.combo.origin}→{o.combo.destination}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0">{_d(o.combo.dates.depart)}{" – " + _d(o.combo.dates.ret) if o.combo.dates.ret else ""}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0">{html.escape(", ".join(o.airlines))}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0">{"direto" if o.stops == 0 else f"{o.stops} parada(s)"}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0;text-align:right;font-weight:600;color:#0f8a4f">{_money(o.price, o.currency)}</td>
          <td style="padding:8px;border-top:1px solid #e2e8f0"><a href="{html.escape(o.url)}">ver ↗</a></td>
        </tr>"""
        for o in offers
    )
    link = f'<p><a href="{app_url}/routes/{route.id}">Abrir no Flight Sniper</a></p>' if app_url else ""
    body = f"""<div style="font-family:system-ui,sans-serif;color:#0f172a;max-width:640px">
      <h2 style="margin:0 0 4px">{html.escape(route.name)}</h2>
      <p style="margin:0 0 16px;color:#64748b">Meta: {_money(route.target_price, route.currency)} ·
        melhor encontrado: <b style="color:#0f8a4f">{_money(best.price, best.currency)}</b></p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">{rows}</table>
      <p style="color:#64748b;font-size:12px">Preço total por {route.adults} adulto(s){" ida e volta" if rt else ""},
        conforme Google Flights no momento da busca. Confirme no site antes de comprar.</p>
      {link}
    </div>"""
    return subject, body


def send_email(api_key: str, sender: str, to: str, subject: str, body_html: str) -> str | None:
    """Envia via API HTTP do Resend.

    Returns:
        ID da mensagem no Resend.

    Raises:
        RuntimeError: Se a API recusar o envio.
    """
    payload = json.dumps({"from": sender, "to": [to], "subject": subject, "html": body_html}).encode()
    req = urllib.request.Request(
        RESEND_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read() or b"{}")
            return data.get("id")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Resend HTTP {exc.code}: {detail}") from exc


def render_push(route: Route, offers: list[Offer], app_url: str) -> dict[str, object]:
    """Monta o payload JSON do ntfy (título, texto e link) sem o tópico."""
    best = offers[0]
    rt = best.combo.dates.ret is not None
    arrow = "⇄" if rt else "→"
    lines = [
        f"{_money(o.price, o.currency)} · {o.combo.origin}{arrow}{o.combo.destination} · "
        f"{_d(o.combo.dates.depart)}{' – ' + _d(o.combo.dates.ret) if o.combo.dates.ret else ''}"
        f" · {', '.join(o.airlines) or '—'}"
        for o in offers[:3]
    ]
    payload: dict[str, object] = {
        "title": f"✈ {route.name}: {_money(best.price, best.currency)} (meta {_money(route.target_price, route.currency)})",
        "message": "\n".join(lines),
        "priority": 4,
        "tags": ["airplane", "moneybag"],
        "click": f"{app_url}/routes/{route.id}" if app_url else best.url,
        "actions": [{"action": "view", "label": "Google Flights", "url": best.url}],
    }
    return payload


def send_ntfy(server: str, topic: str, payload: dict[str, object]) -> None:
    """Publica no ntfy pela API JSON (aceita UTF-8 no título, ao contrário dos headers).

    Raises:
        RuntimeError: Se o servidor recusar a publicação.
    """
    data = json.dumps({"topic": topic, **payload}).encode()
    req = urllib.request.Request(
        server.rstrip("/") + "/",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=20):
            return
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"ntfy HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ntfy indisponível: {exc.reason}") from exc

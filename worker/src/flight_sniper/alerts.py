"""Regra de alerta e envio de e-mail pelo Resend."""

from __future__ import annotations

import html
import json
import logging
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal

from .models import Offer, Route

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def should_alert(best_price: Decimal, target: Decimal, recent_alerted_min: Decimal | None) -> bool:
    """Alerta só abaixo da meta e quando o preço é novidade.

    Args:
        best_price: Menor preço encontrado nesta execução.
        target: Preço alvo da rota.
        recent_alerted_min: Menor preço já alertado dentro do cooldown (ou None).

    Returns:
        True se o e-mail deve ser enviado. Um preço igual ou maior ao já
        alertado no cooldown é suprimido; uma nova queda sempre alerta.
    """
    if best_price >= target:
        return False
    return recent_alerted_min is None or best_price < recent_alerted_min


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
            "User-Agent": "flight-sniper/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read() or b"{}")
            return data.get("id")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"Resend HTTP {exc.code}: {detail}") from exc

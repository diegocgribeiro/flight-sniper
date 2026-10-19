"""Parser tolerante do payload do Google Flights.

O parser do ``fast-flights`` lança ``IndexError`` para a página inteira quando
um único itinerário vem incompleto (ex.: sem preço ou sem dados de emissão),
o que acontece de forma consistente para algumas datas a partir dos IPs do
GitHub Actions. Aqui cada itinerário é lido isoladamente e os malformados são
descartados, preservando o restante dos resultados.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fast_flights.exceptions import FlightsNotFound
from fast_flights.model import Airport, CarbonEmission, Flights, SimpleDatetime, SingleFlight
from fast_flights.parser import _parse_time
from selectolax.lexbor import LexborHTMLParser

logger = logging.getLogger(__name__)


def _parse_itinerary(item: Any) -> Flights:
    flight = item[0]
    price = item[1][0][1]
    segments = [
        SingleFlight(
            from_airport=Airport(code=s[3], name=s[4]),
            to_airport=Airport(code=s[6], name=s[5]),
            departure=SimpleDatetime(date=tuple(s[20]), time=_parse_time(s[8])),
            arrival=SimpleDatetime(date=tuple(s[21]), time=_parse_time(s[10])),
            duration=s[11],
            plane_type=s[17],
        )
        for s in flight[2]
    ]
    return Flights(
        type=flight[0],
        price=price,
        airlines=flight[1],
        flights=segments,
        carbon=CarbonEmission(typical_on_route=0, emission=0),
    )


def parse_html(html: str) -> list[Flights]:
    """Extrai itinerários do HTML, ignorando os que não puderem ser lidos.

    Raises:
        FlightsNotFound: Se o Google indicar que não há voos.
        ValueError: Se o bloco de dados não existir (página de bloqueio/consentimento).
    """
    script = LexborHTMLParser(html).css_first(r"script.ds\:1")
    if script is None:
        raise ValueError("bloco de dados ds:1 ausente (possível bloqueio ou página de consentimento)")
    data = script.text().split("data:", 1)[1].rsplit(",", 1)[0]
    if data.endswith("errorHasStatus: true"):
        raise FlightsNotFound("no flights found; received error")
    payload = json.loads(data)

    items = (payload[3][0] if len(payload) > 3 and payload[3] else None) or []
    result: list[Flights] = []
    skipped = 0
    for item in items:
        try:
            result.append(_parse_itinerary(item))
        except (IndexError, KeyError, TypeError):
            skipped += 1
    if skipped:
        logger.info(
            "Parser tolerante: %d itinerário(s) incompleto(s) ignorado(s), %d lido(s)", skipped, len(result)
        )
    return result

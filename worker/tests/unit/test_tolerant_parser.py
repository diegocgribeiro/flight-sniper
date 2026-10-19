import json

from flight_sniper.tolerant_parser import parse_html


def _segment(frm: str, to: str) -> list:
    seg = [None] * 22
    seg[3], seg[4], seg[5], seg[6] = frm, f"{frm} airport", f"{to} airport", to
    seg[8], seg[10], seg[11], seg[17] = [8, 30], [10], 90, "A320"
    seg[20], seg[21] = [2026, 12, 7], [2026, 12, 7]
    return seg


def _html(items: list) -> str:
    payload = [None, None, None, [items], None, None, None, [None, [[], []]]]
    data = json.dumps(payload)
    js = f'AF_initDataCallback({{key: "ds:1", data:{data}, sideChannel: {{}}}});'
    return f'<script class="ds:1">{js}</script>'


def test_skips_itinerary_without_price():
    good = [["LA", ["LATAM"], [_segment("UDI", "GRU")]], [[None, 415]]]
    no_price = [["G3", ["Gol"], [_segment("UDI", "GIG"), _segment("GIG", "GRU")]], []]
    flights = parse_html(_html([no_price, good]))
    assert len(flights) == 1
    assert flights[0].price == 415
    assert flights[0].flights[0].departure.time == (8, 30)
    assert flights[0].flights[0].arrival.time == (10, 0)


def test_empty_results():
    assert parse_html(_html([])) == []

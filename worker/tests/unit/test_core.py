from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from flight_sniper.alerts import decide_alert
from flight_sniper.dates import all_combos, sample_combos, trip_dates
from flight_sniper.models import Route, ScheduleRule
from flight_sniper.schedule import is_due

SP = ZoneInfo("America/Sao_Paulo")
TODAY = date(2026, 10, 19)


def make_route(**kw) -> Route:
    base = dict(
        id=1,
        name="t",
        origins=["UDI"],
        destinations=["GRU"],
        trip_type="round_trip",
        date_mode="window",
        depart_date=None,
        return_date=None,
        window_start=None,
        window_end=None,
        horizon_days=None,
        min_stay_days=None,
        max_stay_days=None,
        target_price=Decimal("500"),
        currency="BRL",
        adults=1,
        cabin="economy",
        max_stops=None,
        schedule=[ScheduleRule(0, 24, 2)],
        max_queries_per_run=60,
        notify_email=None,
        ntfy_topic=None,
        alert_floor=None,
        cursor=0,
        last_checked_at=None,
    )
    base.update(kw)
    return Route(**base)


class TestTripDates:
    def test_window_round_trip_fits_inside(self):
        r = make_route(
            window_start=date(2026, 12, 1), window_end=date(2026, 12, 12), min_stay_days=4, max_stay_days=4
        )
        ds = trip_dates(r, TODAY)
        assert ds[0].depart == date(2026, 12, 1) and ds[0].ret == date(2026, 12, 5)
        assert ds[-1].depart == date(2026, 12, 8) and ds[-1].ret == date(2026, 12, 12)
        assert len(ds) == 8
        assert all(d.ret <= date(2026, 12, 12) for d in ds)

    def test_window_stay_range(self):
        r = make_route(
            window_start=date(2026, 12, 1), window_end=date(2026, 12, 5), min_stay_days=2, max_stay_days=3
        )
        # ida 1: volta 3,4 | ida 2: 4,5 | ida 3: 5
        assert len(trip_dates(r, TODAY)) == 5

    def test_window_one_way(self):
        r = make_route(trip_type="one_way", window_start=date(2026, 12, 1), window_end=date(2026, 12, 12))
        ds = trip_dates(r, TODAY)
        assert len(ds) == 12 and all(d.ret is None for d in ds)

    def test_window_clipped_to_tomorrow(self):
        r = make_route(trip_type="one_way", window_start=date(2026, 10, 1), window_end=date(2026, 10, 22))
        ds = trip_dates(r, TODAY)
        assert ds[0].depart == date(2026, 10, 20) and len(ds) == 3

    def test_window_in_past_is_empty(self):
        r = make_route(
            window_start=date(2026, 9, 1), window_end=date(2026, 9, 10), min_stay_days=1, max_stay_days=1
        )
        assert trip_dates(r, TODAY) == []

    def test_rolling_return_may_exceed_horizon(self):
        r = make_route(date_mode="rolling", horizon_days=10, min_stay_days=4, max_stay_days=4)
        ds = trip_dates(r, TODAY)
        assert len(ds) == 10
        assert ds[-1].depart == TODAY + timedelta(days=10)

    def test_fixed(self):
        r = make_route(date_mode="fixed", depart_date=date(2026, 12, 5), return_date=date(2026, 12, 10))
        assert [(d.depart, d.ret) for d in trip_dates(r, TODAY)] == [(date(2026, 12, 5), date(2026, 12, 10))]

    def test_combos_multi_airport(self):
        r = make_route(
            origins=["UDI", "CNF"],
            destinations=["LIS", "OPO"],
            date_mode="fixed",
            depart_date=date(2026, 12, 5),
            return_date=date(2026, 12, 10),
        )
        assert len(all_combos(r, TODAY)) == 4


class TestSampleCombos:
    def test_all_when_under_budget(self):
        r = make_route(
            window_start=date(2026, 12, 1), window_end=date(2026, 12, 12), min_stay_days=4, max_stay_days=4
        )
        combos, total = sample_combos(r, TODAY, 60)
        assert total == 8 and len(combos) == 8

    def test_year_round_trip_is_spread_and_capped(self):
        r = make_route(date_mode="rolling", horizon_days=330, min_stay_days=3, max_stay_days=10)
        combos, total = sample_combos(r, TODAY, 60)
        assert total == 330 * 8
        assert len(combos) == 60
        departs = [c.dates.depart for c in combos]
        assert departs[0] == TODAY + timedelta(days=1)
        assert departs[-1] == TODAY + timedelta(days=330)
        assert len({d.weekday() for d in departs}) == 7
        stays = {(c.dates.ret - c.dates.depart).days for c in combos if c.dates.ret}
        assert stays == set(range(3, 11))

    def test_budget_split_between_airport_pairs(self):
        r = make_route(origins=["UDI", "CNF"], trip_type="one_way", date_mode="rolling", horizon_days=180)
        combos, total = sample_combos(r, TODAY, 60)
        assert total == 360 and len(combos) == 60
        assert sum(c.origin == "UDI" for c in combos) == 30

    def test_few_departures_many_stays(self):
        r = make_route(
            window_start=date(2026, 12, 1), window_end=date(2026, 12, 31), min_stay_days=1, max_stay_days=25
        )
        combos, total = sample_combos(r, TODAY, 60)
        assert total > 60 and len(combos) <= 60
        assert all(c.dates.ret <= date(2026, 12, 31) for c in combos)


class TestSchedule:
    RULES = [ScheduleRule(0, 6, 1), ScheduleRule(6, 24, 2)]

    def at(self, hour: int, minute: int = 2) -> datetime:
        return datetime(2026, 10, 19, hour, minute, tzinfo=SP).astimezone(UTC)

    def test_never_checked(self):
        assert is_due(self.RULES, None, self.at(10), SP)

    def test_night_every_hour(self):
        assert is_due(self.RULES, self.at(2, 40), self.at(3), SP)
        assert not is_due(self.RULES, self.at(3, 1), self.at(3, 30), SP)

    def test_day_slots_are_fixed_clock_hours(self):
        # faixa de 2h começando às 6h: 6h, 8h, 10h, 12h, 14h…
        assert not is_due(self.RULES, self.at(14, 1), self.at(15), SP)
        assert is_due(self.RULES, self.at(14, 1), self.at(16), SP)

    def test_late_run_does_not_shift_next_slot(self):
        # disparo atrasado às 13h50 cobre o horário das 12h; às 14h já está na vez
        assert is_due(self.RULES, self.at(13, 50), self.at(14, 0), SP)

    def test_early_trigger_counts_for_next_slot(self):
        assert is_due(self.RULES, self.at(12, 1), self.at(13, 57), SP)

    def test_outside_any_window(self):
        rules = [ScheduleRule(8, 20, 1)]
        assert not is_due(rules, None, self.at(22), SP)


T = Decimal("500")


class TestDecideAlert:
    def test_above_target(self):
        d = decide_alert(Decimal("600"), T, None, complete=True)
        assert not d.send and d.floor is None

    def test_first_alert(self):
        d = decide_alert(Decimal("450"), T, None, complete=True)
        assert d.send and d.floor == Decimal("450")

    def test_same_or_higher_is_not_resent(self):
        assert not decide_alert(Decimal("450"), T, Decimal("450"), complete=True).send
        assert not decide_alert(Decimal("470"), T, Decimal("450"), complete=True).send

    def test_new_drop_alerts(self):
        d = decide_alert(Decimal("430"), T, Decimal("450"), complete=True)
        assert d.send and d.floor == Decimal("430")

    def test_rise_above_target_then_drop_alerts_again(self):
        up = decide_alert(Decimal("520"), T, Decimal("450"), complete=True)
        assert not up.send and up.floor is None
        assert decide_alert(Decimal("480"), T, up.floor, complete=True).send

    def test_incomplete_run_keeps_episode(self):
        d = decide_alert(Decimal("520"), T, Decimal("450"), complete=False)
        assert not d.send and d.floor == Decimal("450")
        assert decide_alert(None, T, Decimal("450"), complete=False).floor == Decimal("450")

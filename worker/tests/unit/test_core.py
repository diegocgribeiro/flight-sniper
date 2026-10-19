from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from flight_sniper.alerts import should_alert
from flight_sniper.dates import all_combos, select_batch, trip_dates
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


class TestSelectBatch:
    def test_all_when_under_budget(self):
        assert select_batch(list(range(5)), 3, 10) == ([0, 1, 2, 3, 4], 0)  # type: ignore[arg-type]

    def test_rotates_and_wraps(self):
        items = list(range(10))
        b1, c1 = select_batch(items, 0, 4)  # type: ignore[arg-type]
        b2, c2 = select_batch(items, c1, 4)  # type: ignore[arg-type]
        b3, c3 = select_batch(items, c2, 4)  # type: ignore[arg-type]
        assert b1 == [0, 1, 2, 3] and b2 == [4, 5, 6, 7] and b3 == [8, 9, 0, 1] and c3 == 2


class TestSchedule:
    RULES = [ScheduleRule(0, 6, 1), ScheduleRule(6, 24, 2)]

    def at(self, hour: int) -> datetime:
        return datetime(2026, 10, 19, hour, 2, tzinfo=SP).astimezone(UTC)

    def test_never_checked(self):
        assert is_due(self.RULES, None, self.at(10), SP)

    def test_night_every_hour(self):
        now = self.at(3)
        assert is_due(self.RULES, now - timedelta(minutes=55), now, SP)

    def test_day_every_two_hours(self):
        now = self.at(14)
        assert not is_due(self.RULES, now - timedelta(minutes=60), now, SP)
        assert is_due(self.RULES, now - timedelta(minutes=110), now, SP)

    def test_outside_any_window(self):
        rules = [ScheduleRule(8, 20, 1)]
        assert not is_due(rules, None, self.at(22), SP)


class TestShouldAlert:
    def test_above_target(self):
        assert not should_alert(Decimal("600"), Decimal("500"), None)

    def test_first_alert(self):
        assert should_alert(Decimal("450"), Decimal("500"), None)

    def test_suppressed_same_or_higher(self):
        assert not should_alert(Decimal("450"), Decimal("500"), Decimal("450"))
        assert not should_alert(Decimal("470"), Decimal("500"), Decimal("450"))

    def test_new_drop_alerts(self):
        assert should_alert(Decimal("430"), Decimal("500"), Decimal("450"))

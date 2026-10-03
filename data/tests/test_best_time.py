from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from holdless_data.events import MemoryEventStore, best_time
from holdless_data.models import CallEvent

TZ = "America/Vancouver"


def test_quietest_slot_from_history():
    bt = best_time(MemoryEventStore(), "Rogers", TZ)
    assert (bt.best_dow, bt.best_hour) == (2, 9)
    assert bt.best_avg_hold_s < 400


def test_call_now_when_current_slot_is_quiet():
    store = MemoryEventStore()
    tue_9am = datetime(2026, 9, 29, 9, 20, tzinfo=ZoneInfo(TZ))
    bt = best_time(store, "rogers", TZ, now=tue_9am)
    assert bt.call_now and bt.label.startswith("now · avg hold")


def test_monday_lunch_is_not_a_good_time():
    bt = best_time(MemoryEventStore(), "rogers", TZ, now=datetime(2026, 9, 28, 12, 30, tzinfo=ZoneInfo(TZ)))
    assert not bt.call_now
    assert bt.label.startswith("Tue 9 am")


def test_live_holds_override_history():
    store = MemoryEventStore()
    now = datetime.now(timezone.utc)
    store.insert([CallEvent(call_id=f"l{i}", company="Rogers Communications", event="hold_ended",
                            hold_seconds=60, time=now - timedelta(minutes=5)) for i in range(2)])
    bt = best_time(store, "rogers", TZ)
    assert bt.live_samples == 2 and bt.call_now and bt.label == "now · avg hold 1 min"


def test_unknown_company():
    bt = best_time(MemoryEventStore(seed_history=False), "Nobody Inc", TZ)
    assert bt.call_now and bt.label == "now · no hold data yet"

"""Call events → "best time to call". Tiger Data in production, in-memory for local runs.

Both stores return the same hourly slots (ISO weekday × local hour, hold-time
weighted by samples); choosing the best slot happens once, in best_time()."""

from __future__ import annotations

import json
import logging
import random
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional, Protocol
from zoneinfo import ZoneInfo

from .models import BestTime, CallEvent, normalize_company

log = logging.getLogger(__name__)

HISTORY_DAYS = 56
MIN_SAMPLES = 3
LIVE_WINDOW = timedelta(hours=1)
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@dataclass
class Slot:
    dow: int  # ISO weekday, 1 = Monday
    hour: int
    avg_hold_s: float
    samples: int
    wins: int = 0
    completed: int = 0


class EventStore(Protocol):
    name: str

    def insert(self, events: Iterable[CallEvent]) -> int: ...

    def slots(self, company: str, tz: str) -> list[Slot]: ...

    def live_hold(self, company: str) -> tuple[Optional[float], int]: ...


# ---------------------------------------------------------------- Tiger Data

SLOTS_SQL = """
SELECT extract(isodow FROM bucket AT TIME ZONE %(tz)s)::int AS dow,
       extract(hour   FROM bucket AT TIME ZONE %(tz)s)::int AS hour,
       sum(avg_hold_s * hold_samples) / nullif(sum(hold_samples), 0) AS avg_hold_s,
       sum(hold_samples)::int AS samples,
       sum(wins)::int         AS wins,
       sum(completed)::int    AS completed
FROM hold_by_hour
WHERE company = %(company)s
  AND bucket >= now() - make_interval(days => %(days)s)
GROUP BY 1, 2
HAVING sum(hold_samples) >= %(min_samples)s
"""

LIVE_SQL = """
SELECT avg(hold_seconds)::double precision, count(*)::int
FROM call_events
WHERE company = %(company)s
  AND event = 'hold_ended'
  AND hold_seconds IS NOT NULL
  AND time > now() - %(window)s
"""

INSERT_SQL = """
INSERT INTO call_events (time, call_id, company, event, hold_seconds, outcome, saved_mo, vibe, meta)
VALUES (%(time)s, %(call_id)s, %(company)s, %(event)s, %(hold_seconds)s, %(outcome)s, %(saved_mo)s, %(vibe)s, %(meta)s)
"""


def _row(e: CallEvent) -> dict:
    return {
        "time": e.time or datetime.now(timezone.utc),
        "call_id": e.call_id,
        "company": normalize_company(e.company),
        "event": e.event,
        "hold_seconds": e.hold_seconds,
        "outcome": e.outcome,
        "saved_mo": e.saved_mo,
        "vibe": e.vibe,
        "meta": json.dumps(e.meta),
    }


class TigerEventStore:
    name = "tiger"

    def __init__(self, url: str) -> None:
        import psycopg

        self._url = url
        self._psycopg = psycopg
        # Fail fast at startup if the URL is wrong.
        with psycopg.connect(url, connect_timeout=5) as conn:
            conn.execute("SELECT 1")

    def _connect(self):
        return self._psycopg.connect(self._url, connect_timeout=5)

    def insert(self, events: Iterable[CallEvent]) -> int:
        rows = [_row(e) for e in events]
        if rows:
            with self._connect() as conn, conn.cursor() as cur:
                cur.executemany(INSERT_SQL, rows)
        return len(rows)

    def insert_rows(self, rows: list[dict]) -> int:
        with self._connect() as conn, conn.cursor() as cur:
            cur.executemany(INSERT_SQL, rows)
        return len(rows)

    def slots(self, company: str, tz: str) -> list[Slot]:
        params = {"tz": tz, "company": normalize_company(company), "days": HISTORY_DAYS, "min_samples": MIN_SAMPLES}
        with self._connect() as conn:
            return [Slot(*r) for r in conn.execute(SLOTS_SQL, params).fetchall()]

    def live_hold(self, company: str) -> tuple[Optional[float], int]:
        with self._connect() as conn:
            avg, n = conn.execute(LIVE_SQL, {"company": normalize_company(company), "window": LIVE_WINDOW}).fetchone()
        return avg, n


# ---------------------------------------------------------------- in-memory


class MemoryEventStore:
    name = "memory"

    def __init__(self, seed_history: bool = True) -> None:
        self._lock = threading.Lock()
        self._rows: list[dict] = synthetic_history() if seed_history else []

    def insert(self, events: Iterable[CallEvent]) -> int:
        rows = [_row(e) for e in events]
        with self._lock:
            self._rows.extend(rows)
        return len(rows)

    def slots(self, company: str, tz: str) -> list[Slot]:
        zone = ZoneInfo(tz)
        cutoff = datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)
        slug = normalize_company(company)
        acc: dict[tuple[int, int], list] = {}
        with self._lock:
            rows = [r for r in self._rows if r["company"] == slug and r["event"] == "completed" and r["time"] >= cutoff]
        for r in rows:
            local = r["time"].astimezone(zone)
            a = acc.setdefault((local.isoweekday(), local.hour), [0.0, 0, 0, 0])
            if r["hold_seconds"] is not None:
                a[0] += r["hold_seconds"]
                a[1] += 1
            a[2] += r["outcome"] == "win"
            a[3] += 1
        return [Slot(d, h, s / n, n, w, c) for (d, h), (s, n, w, c) in acc.items() if n >= MIN_SAMPLES]

    def live_hold(self, company: str) -> tuple[Optional[float], int]:
        cutoff = datetime.now(timezone.utc) - LIVE_WINDOW
        slug = normalize_company(company)
        with self._lock:
            holds = [r["hold_seconds"] for r in self._rows
                     if r["company"] == slug and r["event"] == "hold_ended"
                     and r["hold_seconds"] is not None and r["time"] > cutoff]
        return (sum(holds) / len(holds) if holds else None), len(holds)


def make_store(url: str) -> EventStore:
    if url:
        try:
            return TigerEventStore(url)
        except Exception as e:  # noqa: BLE001 — keep the demo alive
            log.error("Tiger Data unavailable, using in-memory events: %s", e)
    return MemoryEventStore()


# ---------------------------------------------------------------- best time


def _fmt_hold(seconds: float) -> str:
    minutes = round(seconds / 60)
    return "under 1 min" if minutes < 1 else f"{minutes} min"


def _fmt_slot(dow: int, hour: int) -> str:
    suffix = "am" if hour < 12 else "pm"
    h12 = hour % 12 or 12
    return f"{DOW[dow - 1]} {h12} {suffix}"


def best_time(store: EventStore, company: str, tz: str, now: Optional[datetime] = None) -> BestTime:
    slots = store.slots(company, tz)
    live_avg, live_n = store.live_hold(company)
    local_now = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(tz))
    slug = normalize_company(company)

    if not slots:
        label = f"now · live hold {_fmt_hold(live_avg)}" if live_avg is not None else "now · no hold data yet"
        return BestTime(company=slug, call_now=True, live_avg_hold_s=live_avg, live_samples=live_n, label=label)

    best = min(slots, key=lambda s: (s.avg_hold_s, -s.samples))
    current = next((s for s in slots if s.dow == local_now.isoweekday() and s.hour == local_now.hour), None)
    # Live calls in the last hour beat history for "right now".
    now_hold = live_avg if live_n >= 2 else (current.avg_hold_s if current else None)
    call_now = now_hold is not None and now_hold <= max(best.avg_hold_s * 1.25, best.avg_hold_s + 120)

    if call_now:
        label = f"now · avg hold {_fmt_hold(now_hold)}"
    else:
        label = f"{_fmt_slot(best.dow, best.hour)} · avg hold {_fmt_hold(best.avg_hold_s)}"
    return BestTime(
        company=slug, call_now=call_now, now_avg_hold_s=now_hold, live_avg_hold_s=live_avg,
        live_samples=live_n, best_dow=best.dow, best_hour=best.hour, best_avg_hold_s=best.avg_hold_s, label=label,
    )


# ---------------------------------------------------------------- synthetic history

# Base hold minutes per company and the (ISO weekday, local hour) slot that is
# quietest. Synthetic, deterministic and clearly labelled — real calls added
# during the hackathon land on top of it.
_COMPANIES = {
    "rogers": (14, (2, 9)), "telus": (11, (3, 9)), "bell": (16, (2, 10)), "shaw": (12, (4, 9)),
    "fido": (9, (2, 11)), "koodo": (7, (3, 10)), "freedom": (10, (4, 10)), "virgin": (8, (2, 9)),
    "bc hydro": (6, (3, 8)), "air canada": (35, (3, 7)), "westjet": (25, (2, 7)), "goodlife": (5, (2, 10)),
}
_DOW_FACTOR = {1: 1.35, 2: 0.9, 3: 0.95, 4: 1.0, 5: 1.15, 6: 1.1, 7: 1.2}
_HOUR_FACTOR = {7: 0.8, 8: 0.75, 9: 0.8, 10: 0.9, 11: 1.05, 12: 1.4, 13: 1.3, 14: 1.0, 15: 1.0,
                16: 1.15, 17: 1.4, 18: 1.35, 19: 1.1, 20: 0.95, 21: 0.9}


def synthetic_history(tz: str = "America/Vancouver", days: int = HISTORY_DAYS, seed: int = 7,
                      now: Optional[datetime] = None) -> list[dict]:
    rng = random.Random(seed)
    zone = ZoneInfo(tz)
    end = (now or datetime.now(timezone.utc)).astimezone(zone).replace(minute=0, second=0, microsecond=0)
    rows = []
    for company, (base_min, (q_dow, q_hour)) in _COMPANIES.items():
        for d in range(days, 0, -1):
            day = end - timedelta(days=d)
            for hour, hour_factor in _HOUR_FACTOR.items():
                factor = _DOW_FACTOR[day.isoweekday()] * hour_factor
                if (day.isoweekday(), hour) == (q_dow, q_hour):
                    factor *= 0.45
                for i in range(2):
                    hold = base_min * 60 * factor * rng.uniform(0.75, 1.25)
                    started = day.replace(hour=hour, minute=rng.randrange(60)).astimezone(timezone.utc)
                    rows.append({
                        "time": started, "call_id": f"synthetic-{company}-{d}-{hour}-{i}",
                        "company": company, "event": "completed", "hold_seconds": int(hold),
                        "outcome": "win" if rng.random() < 0.62 else "no_deal",
                        "saved_mo": None, "vibe": None, "meta": json.dumps({"synthetic": True}),
                    })
    return rows

"""Deal intel: plan prices + negotiation outcomes → overpay number and playbook.

The queries below are written once in the SQL subset Snowflake and SQLite share
(MEDIAN is registered as a SQLite aggregate), so the local mirror answers with
the same logic Snowflake runs in production. Parameters use :name style and are
rewritten to the connector's %(name)s style for Snowflake."""

from __future__ import annotations

import csv
import logging
import re
import sqlite3
import statistics
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Protocol

from .config import SEED_DIR, Settings

log = logging.getLogger(__name__)

LOOKBACK_DAYS = 365

MARKET_SQL = """
WITH market AS (
    SELECT provider AS company, price AS monthly, 'public' AS kind
    FROM plan_prices
    WHERE service = :service
      AND (:province IS NULL OR province = :province)
      AND (:tier IS NULL OR tier = :tier)
    UNION ALL
    SELECT company, achieved_price, 'crowd'
    FROM deal_intel
    WHERE outcome = 'win'
      AND service = :service
      AND (:province IS NULL OR province = :province)
      AND (:tier IS NULL OR tier = :tier)
      AND created_at >= :since
)
SELECT COUNT(*)                                                         AS samples,
       MEDIAN(monthly)                                                  AS near_price,
       MEDIAN(CASE WHEN kind = 'crowd' AND company = :provider THEN monthly END) AS retention_price,
       SUM(CASE WHEN kind = 'crowd' THEN 1 ELSE 0 END)                  AS crowd_samples
FROM market
"""

COMPETITOR_SQL = """
SELECT provider, plan_name, price, promo_months, regular_price, source_url
FROM plan_prices
WHERE service = :service
  AND (:province IS NULL OR province = :province)
  AND (:tier IS NULL OR tier = :tier)
  AND parent <> :parent
ORDER BY price ASC, provider ASC
LIMIT 1
"""

PLAYBOOK_SQL = """
SELECT argument,
       vibe,
       COUNT(*)                                                   AS attempts,
       SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END)           AS wins,
       MEDIAN(first_offer)                                        AS first_offer,
       MEDIAN(CASE WHEN outcome = 'win' THEN achieved_price END)  AS achieved_price,
       MEDIAN(CASE WHEN outcome = 'win' THEN start_price - achieved_price END) AS saved_mo,
       MEDIAN(CASE WHEN outcome = 'win' THEN months END)          AS months
FROM deal_intel
WHERE company = :company
  AND service = :service
  AND (:province IS NULL OR province = :province)
  AND (:tier IS NULL OR tier = :tier)
  AND created_at >= :since
GROUP BY argument, vibe
ORDER BY wins DESC, attempts ASC, argument ASC, vibe ASC
"""

INSERT_DEAL_SQL = """
INSERT INTO deal_intel (call_id, company, service, tier, province, city, start_price, first_offer,
                        achieved_price, months, argument, vibe, outcome, source, created_at)
VALUES (:call_id, :company, :service, :tier, :province, :city, :start_price, :first_offer,
        :achieved_price, :months, :argument, :vibe, :outcome, :source, :created_at)
"""

PLAN_COLUMNS = ["provider", "parent", "service", "plan_name", "tier", "download_mbps", "data_gb", "price",
                "promo_months", "regular_price", "province", "source_url", "observed_at"]
DEAL_COLUMNS = ["call_id", "company", "service", "tier", "province", "city", "start_price", "first_offer",
                "achieved_price", "months", "argument", "vibe", "outcome", "source", "created_at"]
_NUMERIC = {"download_mbps", "data_gb", "price", "promo_months", "regular_price", "start_price",
            "first_offer", "achieved_price", "months"}


def since_param() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_seed(name: str, columns: list[str]) -> list[dict[str, Any]]:
    rows = []
    with open(SEED_DIR / name, newline="") as f:
        for raw in csv.DictReader(f):
            row: dict[str, Any] = {}
            for col in columns:
                v = (raw.get(col) or "").strip()
                row[col] = (float(v) if v else None) if col in _NUMERIC else (v or None)
            rows.append(row)
    return rows


class IntelStore(Protocol):
    name: str

    def query(self, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]: ...

    def execute(self, sql: str, params: dict[str, Any]) -> None: ...


# ---------------------------------------------------------------- SQLite mirror


class _Median:
    def __init__(self) -> None:
        self.values: list[float] = []

    def step(self, value: Optional[float]) -> None:
        if value is not None:
            self.values.append(float(value))

    def finalize(self) -> Optional[float]:
        return statistics.median(self.values) if self.values else None


class LocalIntelStore:
    """In-memory SQLite loaded from seed/*.csv. Used when Snowflake isn't configured."""

    name = "sqlite"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._db = sqlite3.connect(":memory:", check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.create_aggregate("MEDIAN", 1, _Median)
        num = lambda c: f"{c} REAL" if c in _NUMERIC else f"{c} TEXT"
        self._db.execute(f"CREATE TABLE plan_prices ({', '.join(map(num, PLAN_COLUMNS))})")
        self._db.execute(f"CREATE TABLE deal_intel ({', '.join(map(num, DEAL_COLUMNS))})")
        for table, cols, file in (("plan_prices", PLAN_COLUMNS, "plan_prices.csv"),
                                  ("deal_intel", DEAL_COLUMNS, "deal_intel.csv")):
            self._db.executemany(
                f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(':' + c for c in cols)})",
                load_seed(file, cols),
            )
        self._db.commit()

    def query(self, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, params).fetchall()]

    def execute(self, sql: str, params: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute(sql, params)
            self._db.commit()


# ---------------------------------------------------------------- Snowflake

_NAMED = re.compile(r"(?<![:\w]):([a-z_]+)")


def to_pyformat(sql: str) -> str:
    return _NAMED.sub(r"%(\1)s", sql)


class SnowflakeIntelStore:
    name = "snowflake"

    def __init__(self, settings: Settings) -> None:
        import snowflake.connector

        kwargs = dict(
            account=settings.snowflake_account,
            user=settings.snowflake_user,
            password=settings.snowflake_password,
            warehouse=settings.snowflake_warehouse,
            database=settings.snowflake_database,
            schema=settings.snowflake_schema,
            client_session_keep_alive=True,
        )
        if settings.snowflake_role:
            kwargs["role"] = settings.snowflake_role
        self._lock = threading.Lock()
        self._conn = snowflake.connector.connect(**kwargs)

    def query(self, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        from snowflake.connector import DictCursor

        with self._lock, self._conn.cursor(DictCursor) as cur:
            cur.execute(to_pyformat(sql), params)
            return [{k.lower(): _plain(v) for k, v in row.items()} for row in cur.fetchall()]

    def execute(self, sql: str, params: dict[str, Any]) -> None:
        with self._lock, self._conn.cursor() as cur:
            cur.execute(to_pyformat(sql), params)

    def executemany(self, sql: str, rows: list[dict[str, Any]]) -> None:
        with self._lock, self._conn.cursor() as cur:
            cur.executemany(to_pyformat(sql), rows)


def _plain(v: Any) -> Any:
    # Snowflake returns NUMBER columns as Decimal.
    from decimal import Decimal

    return float(v) if isinstance(v, Decimal) else v


def make_store(settings: Settings) -> IntelStore:
    if settings.snowflake_account:
        try:
            return SnowflakeIntelStore(settings)
        except Exception as e:  # noqa: BLE001 — any connect failure → keep the demo alive
            log.error("Snowflake unavailable, using local SQLite mirror: %s", e)
    return LocalIntelStore()

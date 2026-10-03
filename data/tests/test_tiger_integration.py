"""Runs against a real TimescaleDB when TIGER_TEST_URL is set (schema applied + seeded)."""

import os

import pytest

from holdless_data.events import MemoryEventStore, TigerEventStore, best_time

URL = os.getenv("TIGER_TEST_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TIGER_TEST_URL not set")


def test_tiger_matches_memory_store():
    tiger = best_time(TigerEventStore(URL), "rogers", "America/Vancouver")
    memory = best_time(MemoryEventStore(), "rogers", "America/Vancouver")
    assert (tiger.best_dow, tiger.best_hour) == (memory.best_dow, memory.best_hour) == (2, 9)

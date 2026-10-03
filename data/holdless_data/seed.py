"""Seed the sponsor databases and render the demo bills.

    python -m holdless_data.seed snowflake   # plan_prices + deal_intel (re-runnable)
    python -m holdless_data.seed tiger       # 8 weeks of synthetic call history (re-runnable)
    python -m holdless_data.seed bills       # seed/sample_bills/*.png from the JSON fixtures
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import get_settings
from .events import synthetic_history
from .intel import DEAL_COLUMNS, PLAN_COLUMNS, SnowflakeIntelStore, load_seed

TAX = {"BC": 0.12, "ON": 0.13}


def seed_snowflake() -> None:
    settings = get_settings()
    if not settings.snowflake_account:
        sys.exit("SNOWFLAKE_ACCOUNT is not set (see .env.example)")
    store = SnowflakeIntelStore(settings)
    store.execute("DELETE FROM plan_prices", {})
    store.execute("DELETE FROM deal_intel WHERE source = 'seed'", {})
    plans = load_seed("plan_prices.csv", PLAN_COLUMNS)
    deals = load_seed("deal_intel.csv", DEAL_COLUMNS)
    cols = lambda cs: ", ".join(cs)
    vals = lambda cs: ", ".join(f":{c}" for c in cs)
    store.executemany(f"INSERT INTO plan_prices ({cols(PLAN_COLUMNS)}) VALUES ({vals(PLAN_COLUMNS)})", plans)
    store.executemany(f"INSERT INTO deal_intel ({cols(DEAL_COLUMNS)}) VALUES ({vals(DEAL_COLUMNS)})", deals)
    print(f"snowflake: {len(plans)} plan prices, {len(deals)} seed deals")


def seed_tiger() -> None:
    import psycopg

    from .events import INSERT_SQL

    settings = get_settings()
    if not settings.tiger_url:
        sys.exit("TIGER_DATABASE_URL is not set (see .env.example)")
    rows = synthetic_history(settings.tz)
    with psycopg.connect(settings.tiger_url) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM call_events WHERE call_id LIKE 'synthetic-%'")
            cur.executemany(INSERT_SQL, rows)
        conn.commit()
        # Materialize now so the first /best-time request is fast.
        conn.autocommit = True
        conn.execute("CALL refresh_continuous_aggregate('hold_by_hour', NULL, now() - INTERVAL '1 hour')")
    print(f"tiger: {len(rows)} synthetic completed calls")


def render_bills() -> None:
    from PIL import Image, ImageDraw, ImageFont

    from .bills import SAMPLE_DIR

    font = lambda size: ImageFont.load_default(size=size)
    for path in sorted(SAMPLE_DIR.glob("*.json")):
        bill = json.loads(path.read_text())
        img = Image.new("RGB", (1000, 820), "white")
        d = ImageDraw.Draw(img)
        y = 60
        d.text((60, y), bill["provider"], fill="black", font=font(56)); y += 90
        d.text((60, y), "SAMPLE BILL · HOLDLESS DEMO · NOT A REAL ACCOUNT", fill=(200, 0, 0), font=font(22)); y += 60
        tenure = bill.get("account_tenure_years")
        meta = [
            "Account number: 0000 0000 0000",
            "Bill date: Sep 28, 2026",
            f"Service address: 100 Example St, {bill['city']}, {bill['province']}",
        ]
        if tenure:
            meta.append(f"Customer since: {2026 - int(tenure)}")
        for line in meta:
            d.text((60, y), line, fill=(60, 60, 60), font=font(24)); y += 38
        y += 30
        d.line((60, y, 940, y), fill=(180, 180, 180), width=2); y += 30
        d.text((60, y), "Monthly services", fill="black", font=font(32)); y += 60
        spec = f"{int(bill['download_mbps'])} Mbps" if bill.get("download_mbps") else f"{int(bill['data_gb'])} GB data"
        items = [(f"{bill['plan_name']} ({spec})", bill["monthly_total"])]
        for label in bill.get("one_time_charges", []):
            items.append((label, bill.get("late_fees", 0)))
        subtotal = sum(v for _, v in items)
        tax = round(subtotal * TAX.get(bill["province"], 0.13), 2)
        items += [("Subtotal", subtotal), ("Taxes", tax), ("Total due Oct 20, 2026", subtotal + tax)]
        for label, value in items:
            bold = label.startswith("Total")
            d.text((60, y), label, fill="black", font=font(30 if bold else 26))
            d.text((940, y), f"${value:,.2f}", fill="black", font=font(30 if bold else 26), anchor="ra")
            y += 56 if bold else 46
        img.save(path.with_suffix(".png"))
        print(f"rendered {path.with_suffix('.png').name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", choices=["snowflake", "tiger", "bills"])
    target = parser.parse_args().target
    {"snowflake": seed_snowflake, "tiger": seed_tiger, "bills": render_bills}[target]()


if __name__ == "__main__":
    main()

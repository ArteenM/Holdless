"""Bill photo → BillScan → "you're overpaying $X/mo"."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Optional

from . import llm
from .config import SEED_DIR
from .events import EventStore, best_time
from .intel import COMPETITOR_SQL, MARKET_SQL, IntelStore, since_param
from .models import (
    BillScan, Offer, OverpayResult, normalize_company, normalize_province, parent_of, tier_for,
)

log = logging.getLogger(__name__)

SAMPLE_DIR = SEED_DIR / "sample_bills"
MIN_SAMPLES = 3
WORTH_CALLING_MO = 5.0

SCAN_SYSTEM = """You read Canadian household bills (phone, internet, TV, utilities) from photos \
or PDFs and return the recurring plan the customer pays for.

- monthly_total is the recurring monthly charge for the main service before tax: plan \
price plus add-ons and minus ongoing discounts. Exclude one-time charges, late fees, \
device financing and taxes.
- provider is the brand on the bill (Rogers, TELUS, Bell, Fido, Shaw, BC Hydro, ...).
- download_mbps for internet plans (1 Gbps = 1000). data_gb for mobile plans; use 1000 for unlimited.
- city and province from the service or billing address.
- account_tenure_years if a 'customer since' date is printed.
- late_fees: total late-payment charges on this bill. one_time_charges: short labels of \
other non-recurring charges.
- If a field is not on the bill, leave it null rather than guessing."""


def list_samples() -> list[dict]:
    out = []
    for path in sorted(SAMPLE_DIR.glob("*.json")):
        bill = json.loads(path.read_text())
        image = path.with_suffix(".png")
        out.append({"id": path.stem, "bill": bill, "image": image.name if image.exists() else None})
    return out


def sample_bill(sample_id: str) -> BillScan:
    path = SAMPLE_DIR / f"{sample_id}.json"
    if not path.is_file() or path.parent != SAMPLE_DIR:
        raise KeyError(sample_id)
    return BillScan.model_validate_json(path.read_text())


def _sample_by_image(data: bytes) -> Optional[BillScan]:
    digest = hashlib.sha256(data).hexdigest()
    for image in SAMPLE_DIR.glob("*.png"):
        if hashlib.sha256(image.read_bytes()).hexdigest() == digest:
            return sample_bill(image.stem)
    return None


class ScanFailed(RuntimeError):
    pass


def scan(data: bytes, media_type: str) -> tuple[BillScan, str]:
    """Returns (bill, scanned_by): 'claude' or 'sample'."""
    try:
        bill = llm.parse(
            system=SCAN_SYSTEM,
            content=[llm.image_block(data, media_type), {"type": "text", "text": "Read this bill."}],
            output=BillScan,
        )
        return bill, "claude"
    except llm.LLMUnavailable as e:
        log.warning("bill scan via Claude failed: %s", e)
        if sample := _sample_by_image(data):
            return sample, "sample"
        raise ScanFailed(f"Couldn't read the bill ({e}). Try one of the sample bills.") from e


def _money(x: float) -> str:
    return f"${x:,.0f}" if abs(x - round(x)) < 0.005 else f"${x:,.2f}"


def overpay(intel: IntelStore, events: Optional[EventStore], bill: BillScan, tz: str) -> OverpayResult:
    provider = normalize_company(bill.provider)
    province = normalize_province(bill.province)
    tier = tier_for(bill.service, bill.download_mbps, bill.data_gb)
    base = {"service": bill.service, "provider": provider, "parent": parent_of(provider), "since": since_param()}

    levels = []
    if tier and province:
        levels.append(("tier+province", {"province": province, "tier": tier}))
    if province:
        levels.append(("province", {"province": province, "tier": None}))
    levels.append(("national", {"province": None, "tier": tier}))

    match_level, market, params = "none", None, None
    for level, extra in levels:
        p = {**base, **extra}
        row = intel.query(MARKET_SQL, p)[0]
        if (row["samples"] or 0) >= MIN_SAMPLES and row["near_price"] is not None:
            match_level, market, params = level, row, p
            break

    near = competitor = retention = None
    samples = 0
    if market:
        near = round(float(market["near_price"]), 2)
        samples = int(market["samples"])
        retention = float(market["retention_price"]) if market["retention_price"] is not None else None
        comp = intel.query(COMPETITOR_SQL, params)
        if comp:
            c = comp[0]
            competitor = Offer(
                provider=c["provider"], plan_name=c["plan_name"], price=float(c["price"]),
                promo_months=int(c["promo_months"]) if c["promo_months"] is not None else None,
                regular_price=float(c["regular_price"]) if c["regular_price"] is not None else None,
                source_url=c["source_url"],
            )

    you_pay = round(bill.monthly_total, 2)
    over = round(max(0.0, you_pay - near), 2) if near is not None else 0.0
    where = f"in {bill.city}" if bill.city and match_level != "national" else "near you"
    what = {"internet": "internet plan", "mobile": "phone plan"}.get(bill.service, "plan")

    if over >= WORTH_CALLING_MO:
        headline = f"You're overpaying {_money(over)}/mo"
        detail = f"People {where} pay {_money(near)} for the same {what}. You pay {_money(you_pay)}."
    elif bill.late_fees > 0:
        headline = f"Get your {_money(bill.late_fees)} late fee back"
        detail = "Most companies reverse a first late fee if you ask. We'll ask."
    elif near is not None:
        headline = "You're paying a fair price"
        detail = f"People {where} pay about {_money(near)} for the same {what}. You pay {_money(you_pay)}."
    else:
        headline = "We don't have prices for this one yet"
        detail = "We can still call and ask for their best retention offer."

    return OverpayResult(
        bill=bill, you_pay=you_pay, people_near_you_pay=near, overpay_mo=over, overpay_yr=round(over * 12, 2),
        retention_target=retention, competitor_offer=competitor, samples=samples, match_level=match_level,
        headline=headline, detail=detail,
        best_time=best_time(events, provider, tz) if events else None,
        worth_calling=over >= WORTH_CALLING_MO or bill.late_fees > 0,
    )

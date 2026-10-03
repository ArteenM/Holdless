"""Shapes shared with the rest of the team (app, voice agent, Solana receipt)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Service = Literal["internet", "mobile", "tv", "home_phone", "bundle", "utility", "other"]

# ---------------------------------------------------------------- normalization

_COMPANY_ALIASES = {
    "rogers communications": "rogers",
    "rogers wireless": "rogers",
    "shaw communications": "shaw",
    "bell canada": "bell",
    "bell mobility": "bell",
    "telus communications": "telus",
    "telus mobility": "telus",
    "freedom mobile": "freedom",
    "virgin plus": "virgin",
    "virgin mobile": "virgin",
    "videotron": "videotron",
    "vidéotron": "videotron",
    "bc hydro and power authority": "bc hydro",
}

# Parent company per brand. A rival from the same parent is weak leverage
# ("Fido is cheaper" means little to a Rogers retention rep).
PARENT = {
    "rogers": "rogers", "fido": "rogers", "shaw": "rogers", "chatr": "rogers",
    "bell": "bell", "virgin": "bell", "lucky": "bell",
    "telus": "telus", "koodo": "telus", "public": "telus",
    "freedom": "quebecor", "videotron": "quebecor", "fizz": "quebecor",
}

_PROVINCES = {
    "british columbia": "BC", "alberta": "AB", "saskatchewan": "SK", "manitoba": "MB",
    "ontario": "ON", "quebec": "QC", "québec": "QC", "new brunswick": "NB",
    "nova scotia": "NS", "prince edward island": "PE", "newfoundland and labrador": "NL",
    "yukon": "YT", "northwest territories": "NT", "nunavut": "NU",
}


def normalize_company(name: str) -> str:
    key = " ".join(name.lower().replace(".", " ").split())
    key = _COMPANY_ALIASES.get(key, key)
    for suffix in (" inc", " ltd", " canada"):
        if key.endswith(suffix):
            key = key[: -len(suffix)].strip()
    return _COMPANY_ALIASES.get(key, key)


def parent_of(company: str) -> str:
    slug = normalize_company(company)
    return PARENT.get(slug, slug)


def normalize_province(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    v = value.strip()
    if len(v) == 2:
        return v.upper()
    return _PROVINCES.get(v.lower(), v.upper()[:2])


def tier_for(service: str, download_mbps: Optional[float], data_gb: Optional[float]) -> Optional[str]:
    """Bucket plans so a 1 Gbps plan is compared with other ~1 Gbps plans."""
    if service == "internet":
        if download_mbps is None:
            return None
        if download_mbps <= 150:
            return "basic"
        if download_mbps <= 500:
            return "mid"
        if download_mbps <= 1500:
            return "gig"
        return "multi_gig"
    if service == "mobile":
        if data_gb is None:
            return None
        if data_gb <= 10:
            return "small"
        if data_gb <= 60:
            return "mid"
        if data_gb < 200:
            return "large"
        return "unlimited"
    return None


# ---------------------------------------------------------------- bills / overpay


class BillScan(BaseModel):
    """What we read off a bill. Produced by Claude vision or a sample bill."""

    provider: str = Field(description="Company that issued the bill, e.g. 'Rogers'")
    service: Service
    plan_name: Optional[str] = None
    monthly_total: float = Field(description="Recurring monthly charge for this service, before tax, in CAD")
    download_mbps: Optional[float] = None
    data_gb: Optional[float] = Field(None, description="Mobile data allowance in GB; use 1000 for unlimited")
    city: Optional[str] = None
    province: Optional[str] = None
    account_tenure_years: Optional[float] = None
    late_fees: float = 0.0
    one_time_charges: list[str] = Field(default_factory=list)


class Offer(BaseModel):
    provider: str
    plan_name: str
    price: float
    promo_months: Optional[int] = None
    regular_price: Optional[float] = None
    source_url: Optional[str] = None


class BestTime(BaseModel):
    company: str
    call_now: bool
    now_avg_hold_s: Optional[float] = None
    live_avg_hold_s: Optional[float] = None
    live_samples: int = 0
    best_dow: Optional[int] = Field(None, description="ISO weekday, 1=Mon")
    best_hour: Optional[int] = None
    best_avg_hold_s: Optional[float] = None
    label: str = Field(description="UI string, e.g. 'now · avg hold 4 min' or 'Tue 9 am · avg hold 3 min'")


class OverpayResult(BaseModel):
    bill: BillScan
    you_pay: float
    people_near_you_pay: Optional[float]
    overpay_mo: float
    overpay_yr: float
    retention_target: Optional[float] = Field(None, description="Median price this provider's reps actually gave callers")
    competitor_offer: Optional[Offer] = None
    samples: int = 0
    match_level: Literal["tier+province", "province", "national", "none"] = "none"
    headline: str
    detail: str
    best_time: Optional[BestTime] = None
    worth_calling: bool


# ---------------------------------------------------------------- calls / events

EventType = Literal[
    "dialed", "hold_started", "hold_ended", "rep_joined", "transferred",
    "takeover", "promise", "completed", "failed",
]


class CallEvent(BaseModel):
    call_id: str
    company: str
    event: EventType
    time: Optional[datetime] = None
    hold_seconds: Optional[int] = None
    outcome: Optional[str] = None
    saved_mo: Optional[float] = None
    vibe: Optional[str] = None
    meta: dict = Field(default_factory=dict)


class TranscriptTurn(BaseModel):
    speaker: Literal["rep", "holdless", "user", "system"]
    text: str
    t: Optional[float] = Field(None, description="Seconds since call start")


class Promise(BaseModel):
    kind: Literal[
        "discount", "credit", "refund", "fee_reversal", "cancellation",
        "plan_change", "price_lock", "callback", "other",
    ]
    description: str = Field(description="One plain-English line, e.g. '$25 off per month for 12 months'")
    amount_mo: Optional[float] = Field(None, description="Monthly reduction in CAD")
    months: Optional[int] = None
    one_time_amount: Optional[float] = Field(None, description="One-off credit/refund in CAD")
    effective: Optional[str] = Field(None, description="When it starts, as said on the call")
    quote: str = Field(description="The rep's exact words that made the promise")


class PromiseExtraction(BaseModel):
    outcome: Literal["win", "partial", "no_deal", "cancelled", "escalated", "incomplete"]
    promises: list[Promise]
    rep_id: Optional[str] = None
    rep_name: Optional[str] = None
    confirmation_number: Optional[str] = None
    new_monthly_price: Optional[float] = None
    first_offer_mo: Optional[float] = Field(None, description="Monthly reduction in the rep's first offer")
    winning_argument: Optional[
        Literal["competitor_match", "loyalty", "cancel_threat", "supervisor", "consumer_rights", "hardship", "other"]
    ] = None
    saved_mo: float = 0.0
    saved_total: float = Field(0.0, description="Total over the promised term plus one-time credits")


class CallCompletedIn(BaseModel):
    company: str
    service: Service = "internet"
    vibe: Optional[str] = None
    transcript: list[TranscriptTurn]
    started_at: Optional[datetime] = None
    hold_seconds: Optional[int] = None
    start_price: Optional[float] = None
    province: Optional[str] = None
    city: Optional[str] = None
    tier: Optional[str] = None


class CallCompleted(BaseModel):
    """`call.completed` payload. Mehdi's stamp_receipt takes call_id,
    transcript_sha256 and promises_sha256 straight from here."""

    call_id: str
    company: str
    outcome: str
    promises: list[Promise]
    saved_mo: float
    saved_yr: float
    saved_total: float
    rep_id: Optional[str]
    confirmation_number: Optional[str]
    transcript_sha256: str
    promises_sha256: str
    promises_canonical: str = Field(description="Exact bytes hashed into promises_sha256")
    hold_seconds: Optional[int]
    extracted_by: Literal["claude", "rules"]

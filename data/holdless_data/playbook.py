"""Deal intel → negotiation playbook for the voice agent (Teammate A).

`playbook_text` is meant to be dropped straight into an ElevenLabs dynamic
variable (e.g. {{playbook}}) in the agent's system prompt."""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from pydantic import BaseModel

from .intel import COMPETITOR_SQL, MARKET_SQL, PLAYBOOK_SQL, IntelStore, since_param
from .models import Offer, normalize_company, normalize_province, parent_of, tier_for

ARGUMENT_LINES = {
    "competitor_match": "Quote the competitor price and ask them to match it.",
    "loyalty": "Lead with how long the customer has been with them.",
    "cancel_threat": "Say the customer is ready to cancel today; ask for the retention/loyalty department.",
    "supervisor": "Politely ask for a supervisor when the rep says no.",
    "consumer_rights": "Mention the CCTS complaint process and the Internet/Wireless Code.",
    "hardship": "Explain the customer is in a tough spot this month and ask for a one-time courtesy.",
}


class ArgumentStat(BaseModel):
    argument: str
    attempts: int
    wins: int
    win_rate: float


class Playbook(BaseModel):
    company: str
    service: str
    province: Optional[str]
    tier: Optional[str]
    samples: int
    arguments: list[ArgumentStat]
    best_vibe: Optional[str]
    typical_first_offer_mo: Optional[float]
    target_price: Optional[float]
    accept_at_or_below: Optional[float]
    competitor_offer: Optional[Offer]
    playbook_text: str


def _money(x: float) -> str:
    return f"${x:,.0f}" if abs(x - round(x)) < 0.005 else f"${x:,.2f}"


def build(intel: IntelStore, company: str, service: str, province: Optional[str] = None,
          start_price: Optional[float] = None, tier: Optional[str] = None,
          download_mbps: Optional[float] = None, data_gb: Optional[float] = None) -> Playbook:
    slug = normalize_company(company)
    prov = normalize_province(province)
    tier = tier or tier_for(service, download_mbps, data_gb)
    since = since_param()

    # Narrowest match first: same plan tier in the same province, then widen.
    rows, prov_used, tier_used = [], None, None
    for p, t in dict.fromkeys([(prov, tier), (prov, None), (None, tier), (None, None)]):
        rows = intel.query(PLAYBOOK_SQL, {"company": slug, "service": service, "province": p, "tier": t, "since": since})
        if rows:
            prov_used, tier_used = p, t
            break

    by_arg: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_vibe: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    first_offer_num = first_offer_den = 0.0
    for r in rows:
        attempts, wins = int(r["attempts"]), int(r["wins"] or 0)
        if r["argument"]:
            by_arg[r["argument"]][0] += attempts
            by_arg[r["argument"]][1] += wins
        if r["vibe"]:
            by_vibe[r["vibe"]][0] += attempts
            by_vibe[r["vibe"]][1] += wins
        if r["first_offer"] is not None:
            first_offer_num += float(r["first_offer"]) * attempts
            first_offer_den += attempts

    # Laplace-smoothed so one lucky win doesn't outrank 4/5.
    score = lambda aw: (aw[1] + 1) / (aw[0] + 2)
    arguments = sorted(
        (ArgumentStat(argument=a, attempts=n, wins=w, win_rate=round(w / n, 2)) for a, (n, w) in by_arg.items()),
        key=lambda s: (-score((s.attempts, s.wins)), s.argument),
    )
    best_vibe = min(by_vibe, key=lambda v: (-score(by_vibe[v]), v)) if by_vibe else None
    first_offer = round(first_offer_num / first_offer_den, 2) if first_offer_den else None

    market_params = {"service": service, "provider": slug, "parent": parent_of(slug), "since": since,
                     "province": prov_used, "tier": tier_used}
    market = intel.query(MARKET_SQL, market_params)[0]
    target = market["retention_price"] if market["retention_price"] is not None else market["near_price"]
    target = round(float(target), 2) if target is not None else None
    accept = round(target + 5, 2) if target is not None else None
    if accept is not None and start_price is not None:
        accept = min(accept, round(start_price - 5, 2))

    comp = intel.query(COMPETITOR_SQL, market_params)
    competitor = None
    if comp:
        c = comp[0]
        competitor = Offer(provider=c["provider"], plan_name=c["plan_name"], price=float(c["price"]),
                           promo_months=int(c["promo_months"]) if c["promo_months"] is not None else None,
                           regular_price=float(c["regular_price"]) if c["regular_price"] is not None else None,
                           source_url=c["source_url"])

    samples = sum(n for n, _ in by_arg.values())
    lines = [f"Intel from {samples} past {slug.title()} {service} calls" + (f" in {prov_used}" if prov_used else "") + "."]
    if first_offer is not None:
        lines.append(f"Their first offer is usually about {_money(round(first_offer))}/mo off. Never accept the first offer.")
    if competitor:
        lines.append(f"Leverage: {competitor.plan_name} is {_money(competitor.price)}/mo"
                     + (f" in {prov_used}" if prov_used else "") + ".")
    if target is not None:
        lines.append(f"Target price: {_money(target)}/mo locked for 12 months. Accept anything at or below "
                     f"{_money(accept)}/mo.")
    for s in arguments[:3]:
        if s.wins:
            lines.append(f"Worked {s.wins}/{s.attempts} times: {ARGUMENT_LINES.get(s.argument, s.argument)}")
    lines.append("Before hanging up, always get the rep's ID and a confirmation number, and repeat the deal back.")

    return Playbook(
        company=slug, service=service, province=prov_used, tier=tier_used, samples=samples, arguments=arguments,
        best_vibe=best_vibe, typical_first_offer_mo=first_offer, target_price=target, accept_at_or_below=accept,
        competitor_offer=competitor, playbook_text="\n".join(lines),
    )

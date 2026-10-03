"""Transcript → promises. The output is what gets stamped on Solana, so the
canonical bytes and hashes are produced here, in one place."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Optional

from . import llm
from .models import CallCompleted, Promise, PromiseExtraction, TranscriptTurn

log = logging.getLogger(__name__)

SYSTEM = """You read transcripts of customer-service phone calls placed by Holdless, an AI \
that calls companies on a customer's behalf, and extract exactly what the company's \
representative committed to.

Rules:
- A promise is something the REP agreed to do: a discount, credit, refund, fee reversal, \
cancellation, plan change, price lock or callback. Offers the rep made that Holdless \
turned down are not promises; record the rep's first offer in first_offer_mo instead.
- quote must be the rep's exact words from the transcript, copied verbatim.
- Amounts are CAD. amount_mo is the monthly reduction, not the new price.
- rep_id and confirmation_number only if spoken on the call; never invent them.
- winning_argument is the lever that got the final offer (competitor price → \
competitor_match, years as a customer → loyalty, threatening to leave → cancel_threat, \
asking for a manager → supervisor, citing regulations or the CCTS → consumer_rights).
- outcome: win if at least one money-saving or requested promise was secured; partial if \
something smaller than asked; no_deal if the rep refused; cancelled if the service was \
cancelled as requested; escalated if handed to someone who will call back; incomplete if \
the call ended early."""


def _render(transcript: list[TranscriptTurn]) -> str:
    return "\n".join(f"[{turn.speaker.upper()}] {turn.text}" for turn in transcript)


def extract(transcript: list[TranscriptTurn], company: str = "") -> tuple[PromiseExtraction, str]:
    """Returns (extraction, extracted_by) where extracted_by is 'claude' or 'rules'."""
    try:
        result = llm.parse(
            system=SYSTEM,
            content=[{"type": "text", "text": f"Company: {company or 'unknown'}\n\nTranscript:\n{_render(transcript)}"}],
            output=PromiseExtraction,
        )
        return _with_totals(result), "claude"
    except llm.LLMUnavailable as e:
        log.warning("promise extraction falling back to rules: %s", e)
        return _with_totals(extract_rules(transcript)), "rules"


def _with_totals(x: PromiseExtraction) -> PromiseExtraction:
    """Savings are computed from the promises, never trusted from the model."""
    monthly = sum(p.amount_mo or 0 for p in x.promises)
    total = sum((p.amount_mo or 0) * (p.months or 12) + (p.one_time_amount or 0) for p in x.promises)
    return x.model_copy(update={"saved_mo": round(monthly, 2), "saved_total": round(total, 2)})


def saved_per_year(promises: list[Promise]) -> float:
    return round(
        sum((p.amount_mo or 0) * min(p.months or 12, 12) + (p.one_time_amount or 0) for p in promises), 2
    )


# ---------------------------------------------------------------- rules fallback

_NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "eighteen": 18, "twenty-four": 24, "twenty four": 24,
}
_NUM = r"(\d+|" + "|".join(sorted(_NUM_WORDS, key=len, reverse=True)) + r")"
_MONEY = r"\$\s?(\d+(?:\.\d{1,2})?)"

_RE_DISCOUNT = re.compile(
    _MONEY + r"\s*(?:a month\s*|per month\s*|/mo\s*|monthly\s*)?(?:off|discount|credit)\b"
    r"(?:[^.?!]*?(?:for|over)\s+(?:the next\s+)?" + _NUM + r"\s+months?|[^.?!]*?(?:for|over)\s+(?:a|one|the)\s+year)?",
    re.IGNORECASE,
)
_RE_ONE_TIME = re.compile(
    r"(?:one[- ]time|account|courtesy)\s+credit\s+of\s+" + _MONEY + r"|(?:credit|refund|reverse)\w*\s+(?:you\s+|your account\s+|the\s+)?" + _MONEY,
    re.IGNORECASE,
)
_RE_REP_ID = re.compile(r"\b(?:rep(?:resentative)?|agent|employee|operator)\s*(?:id|number|#)\s*(?:is|:)?\s*([A-Z0-9][A-Z0-9-]{2,})", re.IGNORECASE)
_RE_CONF = re.compile(r"\b(?:confirmation|reference|ticket|case)\s*(?:number|#|code|id)?\s*(?:is|:)?\s*([A-Z0-9][A-Z0-9-]{3,})", re.IGNORECASE)
_RE_CANCEL = re.compile(r"\b(?:has been|is now|I've|I have)\s+(?:been\s+)?cancel+ed\b", re.IGNORECASE)
_RE_REFUSE = re.compile(r"\b(?:can't|cannot|unable to|not able to)\s+(?:do|offer|give|apply)\b", re.IGNORECASE)


def _num(token: Optional[str]) -> Optional[int]:
    if token is None:
        return None
    return int(token) if token.isdigit() else _NUM_WORDS.get(token.lower())


def _sentence_with(text: str, start: int, end: int) -> str:
    left = max(text.rfind(c, 0, start) for c in ".?!")
    right_candidates = [i for i in (text.find(c, end) for c in ".?!") if i != -1]
    right = min(right_candidates) + 1 if right_candidates else len(text)
    return text[left + 1 : right].strip()


def extract_rules(transcript: list[TranscriptTurn]) -> PromiseExtraction:
    offers: list[Promise] = []
    one_time: list[Promise] = []
    rep_id = confirmation = None
    cancelled = refused = False
    winning_argument = None

    for turn in transcript:
        if turn.speaker == "holdless":
            low = turn.text.lower()
            if any(w in low for w in ("telus", "bell", "freedom", "rogers", "competitor", "has this plan")):
                winning_argument = winning_argument or "competitor_match"
            if "cancel" in low:
                winning_argument = "cancel_threat" if winning_argument is None else winning_argument
            continue
        if turn.speaker != "rep":
            continue
        text = turn.text
        for m in _RE_DISCOUNT.finditer(text):
            months = _num(m.group(2)) or (12 if "year" in m.group(0).lower() else None)
            amount = float(m.group(1))
            offers.append(Promise(
                kind="discount",
                description=f"${amount:g} off per month" + (f" for {months} months" if months else ""),
                amount_mo=amount, months=months,
                quote=_sentence_with(text, m.start(), m.end()),
            ))
        for m in _RE_ONE_TIME.finditer(text):
            if _RE_DISCOUNT.search(text[m.start():m.end() + 20]):
                continue
            amount = float(m.group(1) or m.group(2))
            kind = "fee_reversal" if "fee" in text.lower() or "reverse" in m.group(0).lower() else "credit"
            one_time.append(Promise(
                kind=kind, description=f"${amount:g} one-time {kind.replace('_', ' ')}",
                one_time_amount=amount, quote=_sentence_with(text, m.start(), m.end()),
            ))
        if m := _RE_REP_ID.search(text):
            rep_id = m.group(1)
        if m := _RE_CONF.search(text):
            confirmation = m.group(1)
        cancelled = cancelled or bool(_RE_CANCEL.search(text))
        refused = refused or bool(_RE_REFUSE.search(text))

    # The rep's last offer is the one that stuck; earlier ones were negotiated past.
    promises = ([offers[-1]] if offers else []) + one_time
    if cancelled:
        promises.append(Promise(kind="cancellation", description="Service cancelled", quote="cancelled"))
    if promises:
        outcome = "cancelled" if cancelled and not offers else "win"
    else:
        outcome = "no_deal" if refused else "incomplete"
    return PromiseExtraction(
        outcome=outcome, promises=promises, rep_id=rep_id, confirmation_number=confirmation,
        first_offer_mo=offers[0].amount_mo if offers else None,
        winning_argument=winning_argument if offers else None,
    )


# ---------------------------------------------------------------- receipts


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_completed(
    call_id: str,
    company: str,
    transcript: list[TranscriptTurn],
    extraction: PromiseExtraction,
    extracted_by: str,
    hold_seconds: Optional[int],
) -> CallCompleted:
    transcript_canonical = canonical_json([t.model_dump(mode="json") for t in transcript])
    promises_canonical = canonical_json({
        "call_id": call_id,
        "company": company,
        "outcome": extraction.outcome,
        "rep_id": extraction.rep_id,
        "confirmation_number": extraction.confirmation_number,
        "promises": [p.model_dump(mode="json") for p in extraction.promises],
    })
    return CallCompleted(
        call_id=call_id,
        company=company,
        outcome=extraction.outcome,
        promises=extraction.promises,
        saved_mo=extraction.saved_mo,
        saved_yr=saved_per_year(extraction.promises),
        saved_total=extraction.saved_total,
        rep_id=extraction.rep_id,
        confirmation_number=extraction.confirmation_number,
        transcript_sha256=sha256_hex(transcript_canonical),
        promises_sha256=sha256_hex(promises_canonical),
        promises_canonical=promises_canonical,
        hold_seconds=hold_seconds,
        extracted_by=extracted_by,
    )

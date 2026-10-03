import json
from types import SimpleNamespace

from holdless_data import llm, promises
from holdless_data.models import Promise, PromiseExtraction, TranscriptTurn

GOLDEN = [
    TranscriptTurn(speaker="rep", text="Best I can do is $5 off for three months."),
    TranscriptTurn(speaker="holdless", text="Mehdi's been with you six years. Telus has this plan at $55. "
                                            "Match it for twelve months, or we're cancelling today."),
    TranscriptTurn(speaker="rep", text="...Let me check with my supervisor."),
    TranscriptTurn(speaker="rep", text="I've got approval for $25 off a month, for 12 months."),
    TranscriptTurn(speaker="holdless", text="Great. Can I get your rep ID and a confirmation number?"),
    TranscriptTurn(speaker="rep", text="Sure. My rep ID is R4471 and your confirmation number is CNF-882913."),
]


def test_rules_golden_path():
    x, by = promises.extract(GOLDEN, "rogers")
    assert by == "rules"
    assert x.outcome == "win"
    assert len(x.promises) == 1
    p = x.promises[0]
    assert (p.kind, p.amount_mo, p.months) == ("discount", 25, 12)
    assert p.quote == "I've got approval for $25 off a month, for 12 months."
    assert x.first_offer_mo == 5
    assert x.rep_id == "R4471"
    assert x.confirmation_number == "CNF-882913"
    assert x.winning_argument == "competitor_match"
    assert x.saved_mo == 25 and x.saved_total == 300


def test_rules_number_words_and_one_time_credit():
    t = [
        TranscriptTurn(speaker="rep", text="I can reverse the $25 late fee."),
        TranscriptTurn(speaker="rep", text="And $10 off per month for six months."),
    ]
    x = promises.extract_rules(t)
    kinds = {p.kind: p for p in x.promises}
    assert kinds["discount"].months == 6
    assert kinds["fee_reversal"].one_time_amount == 25
    assert promises._with_totals(x).saved_total == 85


def test_rules_refusal():
    x = promises.extract_rules([TranscriptTurn(speaker="rep", text="Sorry, I can't offer anything on that plan.")])
    assert x.outcome == "no_deal" and x.promises == []


def test_receipt_hashes_are_canonical():
    x, by = promises.extract(GOLDEN, "rogers")
    a = promises.build_completed("c1", "rogers", GOLDEN, x, by, 872)
    b = promises.build_completed("c1", "rogers", GOLDEN, x, by, 872)
    assert a.promises_sha256 == b.promises_sha256
    assert a.promises_sha256 == promises.sha256_hex(a.promises_canonical)
    assert json.loads(a.promises_canonical)["rep_id"] == "R4471"
    assert a.saved_yr == 300
    other = promises.build_completed("c2", "rogers", GOLDEN, x, by, 872)
    assert other.promises_sha256 != a.promises_sha256
    assert other.transcript_sha256 == a.transcript_sha256


def _fake_client(response):
    calls = []

    class Messages:
        def parse(self, **kwargs):
            calls.append(kwargs)
            return response

    return SimpleNamespace(beta=SimpleNamespace(messages=Messages())), calls


def test_claude_path_recomputes_savings(monkeypatch):
    parsed = PromiseExtraction(
        outcome="win",
        promises=[Promise(kind="discount", description="$25 off per month for 12 months", amount_mo=25,
                          months=12, quote="I've got approval for $25 off a month, for 12 months."),
                  Promise(kind="credit", description="$40 credit", one_time_amount=40, quote="I'll add a $40 credit.")],
        rep_id="R4471", saved_mo=999, saved_total=999,
    )
    client, calls = _fake_client(SimpleNamespace(stop_reason="end_turn", parsed_output=parsed, _request_id="req_1"))
    monkeypatch.setenv("HOLDLESS_LLM", "on")
    monkeypatch.setattr(llm, "_client", lambda: client)
    x, by = promises.extract(GOLDEN, "rogers")
    assert by == "claude"
    assert x.saved_mo == 25 and x.saved_total == 340
    assert promises.saved_per_year(x.promises) == 340
    req = calls[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["output_format"] is PromiseExtraction
    assert req["fallbacks"] == "default"
    assert "[REP] Best I can do" in req["messages"][0]["content"][0]["text"]


def test_claude_refusal_falls_back_to_rules(monkeypatch):
    client, _ = _fake_client(SimpleNamespace(stop_reason="refusal", parsed_output=None, _request_id="req_2"))
    monkeypatch.setenv("HOLDLESS_LLM", "on")
    monkeypatch.setattr(llm, "_client", lambda: client)
    x, by = promises.extract(GOLDEN, "rogers")
    assert by == "rules" and x.saved_mo == 25

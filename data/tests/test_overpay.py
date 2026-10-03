from holdless_data import bills
from holdless_data.events import MemoryEventStore
from holdless_data.intel import LocalIntelStore
from holdless_data.models import BillScan

TZ = "America/Vancouver"


def run(bill, events=None):
    return bills.overpay(LocalIntelStore(), events, bill, TZ)


def test_golden_path_rogers_bill():
    r = run(bills.sample_bill("rogers_internet"), MemoryEventStore())
    assert r.you_pay == 96
    assert r.people_near_you_pay == 55
    assert r.overpay_mo == 41
    assert r.overpay_yr == 492
    assert r.headline == "You're overpaying $41/mo"
    assert r.detail == "People in Surrey pay $55 for the same internet plan. You pay $96."
    assert r.match_level == "tier+province"
    assert r.retention_target == 55
    # Leverage must come from a different parent company, same speed tier.
    assert r.competitor_offer.provider == "freedom"
    assert r.competitor_offer.plan_name.endswith("1 Gbps")
    assert r.worth_calling
    assert r.best_time.label.startswith(("now", "Tue 9 am"))


def test_competitor_skips_same_parent():
    r = run(bills.sample_bill("bell_mobile"))
    assert r.competitor_offer.provider not in ("bell", "virgin", "lucky")


def test_widens_when_tier_unknown():
    bill = BillScan(provider="Rogers", service="internet", monthly_total=96, province="British Columbia")
    r = run(bill)
    assert r.match_level == "province"
    assert r.people_near_you_pay is not None


def test_no_market_data():
    bill = BillScan(provider="Acme Gym", service="other", monthly_total=60)
    r = run(bill)
    assert r.match_level == "none"
    assert r.overpay_mo == 0
    assert not r.worth_calling


def test_late_fee_is_worth_a_call_even_at_fair_price():
    bill = BillScan(provider="TELUS", service="mobile", monthly_total=50, data_gb=100, province="BC", late_fees=25)
    r = run(bill)
    assert r.overpay_mo == 0
    assert r.headline == "Get your $25 late fee back"
    assert r.worth_calling


def test_fair_price():
    bill = BillScan(provider="Freedom", service="internet", monthly_total=55, download_mbps=1000, province="BC")
    r = run(bill)
    assert r.headline == "You're paying a fair price"
    assert not r.worth_calling

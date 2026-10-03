from holdless_data.intel import to_pyformat
from holdless_data.models import normalize_company, normalize_province, parent_of, tier_for


def test_pyformat_rewrite_leaves_casts_alone():
    assert to_pyformat("SELECT x::int FROM t WHERE a = :a AND b = :b_c") == \
        "SELECT x::int FROM t WHERE a = %(a)s AND b = %(b_c)s"


def test_normalization():
    assert normalize_company("Rogers Communications Inc.") == "rogers"
    assert normalize_company("TELUS") == "telus"
    assert parent_of("Fido") == "rogers"
    assert normalize_province("British Columbia") == "BC"
    assert tier_for("internet", 940, None) == "gig"
    assert tier_for("mobile", None, 1000) == "unlimited"

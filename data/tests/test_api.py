from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from holdless_data.api import create_app
from holdless_data.events import MemoryEventStore
from holdless_data.intel import LocalIntelStore

SAMPLES = Path(__file__).resolve().parent.parent / "seed" / "sample_bills"


@pytest.fixture
def client():
    return TestClient(create_app(intel=LocalIntelStore(), event_store=MemoryEventStore()))


def test_health(client):
    assert client.get("/health").json() == {"ok": True, "intel": "sqlite", "events": "memory", "llm": False}


def test_scan_sample(client):
    r = client.post("/bills/scan", data={"sample": "rogers_internet"})
    assert r.status_code == 200
    body = r.json()
    assert body["scanned_by"] == "sample" and body["overpay_mo"] == 41


def test_scan_upload_of_sample_image_works_offline(client):
    with open(SAMPLES / "rogers_internet.png", "rb") as f:
        r = client.post("/bills/scan", files={"file": ("bill.png", f, "image/png")})
    assert r.status_code == 200 and r.json()["headline"] == "You're overpaying $41/mo"


def test_scan_unknown_photo_without_llm_is_503(client):
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "white").save(buf, "PNG")
    r = client.post("/bills/scan", files={"file": ("x.png", buf.getvalue(), "image/png")})
    assert r.status_code == 503 and "sample" in r.json()["detail"]


def test_scan_errors(client):
    assert client.post("/bills/scan", data={"sample": "../config"}).status_code == 404
    assert client.post("/bills/scan", files={"file": ("x.heic", b"..", "image/heic")}).status_code == 415
    assert client.post("/bills/scan").status_code == 422


def test_samples_listed_and_served(client):
    ids = [s["id"] for s in client.get("/bills/samples").json()]
    assert ids == ["bell_mobile", "rogers_internet", "telus_mobile"]
    assert client.get("/samples/rogers_internet.png").status_code == 200


def test_completed_call_feeds_the_brain(client):
    before = client.get("/playbook", params={"company": "Rogers", "province": "BC", "tier": "gig"}).json()
    transcript = [
        {"speaker": "rep", "text": "I can do $5 off for three months."},
        {"speaker": "holdless", "text": "Telus has this plan at $55. Match it or we cancel."},
        {"speaker": "rep", "text": "I've got approval for $25 off a month, for 12 months."},
        {"speaker": "rep", "text": "My rep ID is R4471, confirmation number CNF-882913."},
    ]
    r = client.post("/calls/c42/completed", json={
        "company": "Rogers", "vibe": "relentless", "transcript": transcript, "hold_seconds": 872,
        "start_price": 96, "province": "BC", "city": "Surrey", "tier": "gig",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["call_id"] == "c42" and body["outcome"] == "win" and body["saved_yr"] == 300
    assert len(body["promises_sha256"]) == 64
    after = client.get("/playbook", params={"company": "Rogers", "province": "BC", "tier": "gig"}).json()
    assert after["samples"] == before["samples"] + 1


def test_events_single_and_batch(client):
    assert client.post("/events", json={"call_id": "a", "company": "Bell", "event": "dialed"}).json() == {"inserted": 1}
    batch = [{"call_id": "a", "company": "Bell", "event": "hold_ended", "hold_seconds": 90}] * 2
    assert client.post("/events", json=batch).json() == {"inserted": 2}
    assert client.get("/best-time", params={"company": "bell"}).json()["live_samples"] == 2


def test_playbook_text_for_voice_agent(client):
    pb = client.get("/playbook", params={"company": "Rogers", "province": "BC", "download_mbps": 1000,
                                         "start_price": 96}).json()
    assert pb["tier"] == "gig" and pb["best_vibe"] == "relentless"
    assert pb["target_price"] == 55 and pb["accept_at_or_below"] == 60
    assert "Freedom Home Internet 1 Gbps is $50/mo" in pb["playbook_text"]
    assert "rep's ID and a confirmation number" in pb["playbook_text"]

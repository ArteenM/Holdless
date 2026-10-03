"""HTTP API for the app (Teammate C), the voice agent (Teammate A) and the
receipt program (Mehdi). Run:  uvicorn holdless_data.api:app --reload --port 8100"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import bills, events as events_mod, intel as intel_mod, playbook as playbook_mod, promises
from .config import get_settings
from .models import (
    BestTime, BillScan, CallCompleted, CallCompletedIn, CallEvent, OverpayResult, PromiseExtraction,
    TranscriptTurn, normalize_company, normalize_province,
)

log = logging.getLogger("holdless_data")

MAX_IMAGE_BYTES = 4_500_000
MAX_IMAGE_SIDE = 2000
ACCEPTED = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}


class ScanResult(OverpayResult):
    scanned_by: str


def _shrink(data: bytes, media_type: str) -> tuple[bytes, str]:
    """Phone photos are often >5 MB; Claude reads a 2000px JPEG just as well."""
    if media_type == "application/pdf":
        return data, media_type
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    if len(data) <= MAX_IMAGE_BYTES and max(img.size) <= MAX_IMAGE_SIDE:
        return data, media_type
    img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=85)
    return out.getvalue(), "image/jpeg"


def create_app(intel=None, event_store=None) -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Holdless data", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.mount("/samples", StaticFiles(directory=bills.SAMPLE_DIR), name="samples")

    state = {"intel": intel, "events": event_store}

    def get_intel():
        if state["intel"] is None:
            state["intel"] = intel_mod.make_store(settings)
        return state["intel"]

    def get_events():
        if state["events"] is None:
            state["events"] = events_mod.make_store(settings.tiger_url)
        return state["events"]

    @app.get("/health")
    def health():
        return {"ok": True, "intel": get_intel().name, "events": get_events().name, "llm": settings.llm_enabled}

    # ---------------------------------------------------------------- bills

    @app.get("/bills/samples")
    def samples():
        return bills.list_samples()

    @app.post("/bills/scan", response_model=ScanResult)
    async def scan(file: Optional[UploadFile] = File(None), sample: Optional[str] = Form(None)):
        if sample:
            try:
                bill, by = bills.sample_bill(sample), "sample"
            except KeyError:
                raise HTTPException(404, f"no sample bill '{sample}'")
        elif file is not None:
            media_type = (file.content_type or "").split(";")[0]
            if media_type not in ACCEPTED:
                raise HTTPException(415, f"unsupported file type {media_type or 'unknown'}; send JPEG, PNG, WebP or PDF")
            data, media_type = _shrink(await file.read(), media_type)
            try:
                bill, by = bills.scan(data, media_type)
            except bills.ScanFailed as e:
                raise HTTPException(503, str(e))
        else:
            raise HTTPException(422, "send a bill as `file`, or `sample` with a sample id")
        result = bills.overpay(get_intel(), get_events(), bill, settings.tz)
        return ScanResult(**result.model_dump(), scanned_by=by)

    @app.post("/overpay", response_model=OverpayResult)
    def overpay(bill: BillScan):
        return bills.overpay(get_intel(), get_events(), bill, settings.tz)

    # ---------------------------------------------------------------- calls

    @app.get("/best-time", response_model=BestTime)
    def best_time(company: str = Query(..., examples=["Rogers"])):
        return events_mod.best_time(get_events(), company, settings.tz)

    @app.post("/events")
    def ingest(events: list[CallEvent] | CallEvent):
        batch = events if isinstance(events, list) else [events]
        return {"inserted": get_events().insert(batch)}

    @app.get("/playbook", response_model=playbook_mod.Playbook)
    def playbook(company: str, service: str = "internet", province: Optional[str] = None,
                 start_price: Optional[float] = None, tier: Optional[str] = None,
                 download_mbps: Optional[float] = None, data_gb: Optional[float] = None):
        return playbook_mod.build(get_intel(), company, service, province, start_price, tier, download_mbps, data_gb)

    @app.post("/promises/extract", response_model=PromiseExtraction)
    def extract(transcript: list[TranscriptTurn], company: str = ""):
        return promises.extract(transcript, company)[0]

    @app.post("/calls/{call_id}/completed", response_model=CallCompleted)
    def completed(call_id: str, body: CallCompletedIn):
        company = normalize_company(body.company)
        extraction, by = promises.extract(body.transcript, company)
        result = promises.build_completed(call_id, company, body.transcript, extraction, by, body.hold_seconds)
        _record(call_id, company, body, extraction, result)
        return result

    def _record(call_id, company, body: CallCompletedIn, x: PromiseExtraction, result: CallCompleted) -> None:
        started = body.started_at or datetime.now(timezone.utc)
        try:
            get_events().insert([CallEvent(
                call_id=call_id, company=company, event="completed", time=started,
                hold_seconds=body.hold_seconds, outcome=x.outcome, saved_mo=x.saved_mo, vibe=body.vibe,
                meta={"promises_sha256": result.promises_sha256},
            )])
        except Exception:  # noqa: BLE001 — the receipt matters more than the stats
            log.exception("failed to record call %s in events store", call_id)
        months = next((p.months for p in x.promises if p.amount_mo), None)
        try:
            get_intel().execute(intel_mod.INSERT_DEAL_SQL, {
                "call_id": call_id, "company": company, "service": body.service, "tier": body.tier,
                "province": normalize_province(body.province), "city": body.city,
                "start_price": body.start_price, "first_offer": x.first_offer_mo,
                "achieved_price": round(body.start_price - x.saved_mo, 2) if body.start_price is not None else None,
                "months": months, "argument": x.winning_argument, "vibe": body.vibe, "outcome": x.outcome,
                "source": "call", "created_at": started.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
        except Exception:  # noqa: BLE001
            log.exception("failed to record call %s in deal intel", call_id)

    return app


app = create_app()

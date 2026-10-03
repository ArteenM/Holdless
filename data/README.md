# Holdless data service (Teammate B: Tiger Data, Snowflake, promise extraction)

This is "the brain" from the idea board. It turns a bill photo into an overpay number. Every call's events go into Tiger Data and come back as a best time to call. Every deal goes into Snowflake and comes back as the voice agent's playbook. Every transcript becomes the promises that Mehdi stamps on Solana.

```
bill photo ──Claude──▶ BillScan ──Snowflake──▶ "You're overpaying $41/mo"
                                         ▲             + best time (Tiger)
voice agent ──POST /events──▶ Tiger call_events ──▶ hold_by_hour (continuous aggregate)
call ends ──POST /calls/:id/completed──▶ promises + hashes ──▶ Mehdi's stamp_receipt
                                    └──▶ deal_intel row (Snowflake) ──▶ GET /playbook (next call)
```

**Done when** a bill photo returns a real overpay number. With the seeded data, the Rogers sample gives
`$41/mo · People in Surrey pay $55 for the same internet plan. You pay $96.`

## Run it

```bash
cd data
pip install -r requirements.txt
cp .env.example .env            # optional: fill in what you have
uvicorn holdless_data.api:app --reload --port 8100
# open http://localhost:8100/docs
```

Nothing has to be configured. Each piece falls back to a local stand-in, so the golden path still works on venue Wi-Fi:

| Piece | Configured | Fallback |
|---|---|---|
| Bill reading + promise extraction | Claude (`ANTHROPIC_API_KEY`) | 3 sample bills + regex promise parser |
| Call events / best time | Tiger Data (`TIGER_DATABASE_URL`) | in-memory store with the same synthetic history |
| Plan prices / deal intel | Snowflake (`SNOWFLAKE_*`) | in-memory SQLite running **the same SQL** |

`GET /health` tells you which one is live.

### Tiger Data setup
```bash
psql "$TIGER_DATABASE_URL" -f sql/tiger/001_call_events.sql
python -m holdless_data.seed tiger        # 8 weeks of synthetic call history, safe to re-run
```

### Snowflake setup
Run `sql/snowflake/001_schema.sql` in a worksheet, then:
```bash
python -m holdless_data.seed snowflake    # plan_prices + seed deal_intel, safe to re-run
```

### Tests
```bash
python -m pytest
TIGER_TEST_URL=postgresql://... python -m pytest tests/test_tiger_integration.py   # against a seeded Tiger DB
```

## API, by teammate

All JSON. CORS is open. Full schemas are at `/docs`.

### For C (app on holdless.tech)

| Call | Use it for |
|---|---|
| `POST /bills/scan` multipart `file` (JPEG/PNG/WebP/PDF) **or** form field `sample=rogers_internet` | Home screen "You're overpaying" card |
| `GET /bills/samples` | The 3 demo bills. Images are at `/samples/<id>.png` |
| `GET /best-time?company=Rogers` | "Best time to call: now · avg hold 4 min" |

Fields from `/bills/scan` that map straight onto the mockup: `headline` ("You're overpaying $41/mo"), `detail` ("People in Surrey pay $55…"), `best_time.label`, `overpay_mo`, `overpay_yr`, and `worth_calling` (hide the Call button when false). `scanned_by` is `claude` or `sample`.

Phone photos are downscaled automatically. iPhone HEIC isn't accepted, so use `<input type="file" accept="image/*">`; browsers send JPEG.

### For A (ElevenLabs voice agent)

- **Before dialing:** `GET /playbook?company=Rogers&service=internet&province=BC&download_mbps=1000&start_price=96`.
  Put `playbook_text` into the agent's dynamic variable (e.g. `{{playbook}}`). `best_vibe`, `target_price`, `accept_at_or_below` and `competitor_offer` are also there if you want them as separate variables.
- **During the call:** `POST /events` with a single event or a list:
  `{call_id, company, event, hold_seconds?, vibe?, meta?}`. `event` is one of `dialed`, `hold_started`, `hold_ended`, `rep_joined`, `transferred`, `takeover`, `promise`, `completed`, `failed`.
  Send `hold_ended` with `hold_seconds`. Those events power the live "now · avg hold N min".

### For Mehdi (receipts + `call.completed`)

`POST /calls/{call_id}/completed`
```json
{ "company": "Rogers", "service": "internet", "vibe": "relentless",
  "transcript": [{"speaker": "rep", "text": "I can do $5 off for three months."}, ...],
  "started_at": "2026-10-03T16:40:00Z", "hold_seconds": 872,
  "start_price": 96, "province": "BC", "city": "Surrey", "tier": "gig" }
```
It returns the `call.completed` payload:
```json
{ "call_id": "c42", "company": "rogers", "outcome": "win",
  "promises": [{"kind": "discount", "description": "$25 off per month for 12 months",
                "amount_mo": 25, "months": 12, "quote": "I've got approval for $25 off a month, for 12 months."}],
  "saved_mo": 25, "saved_yr": 300, "saved_total": 300,
  "rep_id": "R4471", "confirmation_number": "CNF-882913",
  "transcript_sha256": "…", "promises_sha256": "…", "promises_canonical": "{…}",
  "hold_seconds": 872, "extracted_by": "claude" }
```
`stamp_receipt` can take `call_id`, `transcript_sha256` and `promises_sha256` as they are. `promises_canonical` is the exact UTF-8 string that was hashed (sorted keys, no spaces), so anyone can check the Explorer proof. The savings numbers are calculated from the promises in code; the model's arithmetic is never used. The same call also writes a `completed` event to Tiger and a row to Snowflake `deal_intel`, so the next playbook knows about it.

`POST /promises/extract` (a transcript array) runs the extraction alone, with no recording. Use it for the "promise detected" chip on the live screen.

## How the numbers are made

- **People near you pay:** `MEDIAN` over public prices for the same service, province and plan tier (1 Gbps vs 1 Gbps, 100 GB vs 100 GB), plus crowd-sourced winning deals from the past year. If there are fewer than 3 samples, it widens to the province and then to national.
- **Competitor offer (leverage):** the cheapest same-tier plan from a *different parent company*. Fido doesn't count as leverage against Rogers.
- **Retention target:** the median price this provider's reps actually gave callers.
- **Best time to call:** Tiger continuous aggregate `hold_by_hour`, grouped by local weekday × hour over the last 8 weeks. "Now" wins if the current slot, or live holds in the last hour, is within 25% (or 2 min) of the quietest slot. Real-time aggregation is on, so a call that just finished counts right away.

The intel queries in `holdless_data/intel.py` are written once. They run on Snowflake and also on the local SQLite mirror (with `MEDIAN` registered as a SQLite function), so offline answers match production.

## Data honesty

The `seed/plan_prices.csv` prices are **illustrative values for the demo**, shaped like public Canadian plans. Check them against the providers' sites before quoting them to judges. `seed/deal_intel.csv` and the Tiger history are synthetic and labelled as such (`source = 'seed'`, `call_id LIKE 'synthetic-%'`). Real calls made during the hackathon are added on top. Sample bills are stamped "SAMPLE BILL · NOT A REAL ACCOUNT".

## Sponsor-track blurbs (for Devpost)

**Tiger Data.** Every Holdless call streams events (dialed, on hold, rep joined, completed) into a TimescaleDB hypertable on Tiger Cloud. A real-time continuous aggregate rolls them into hold time and win rate per company per hour, and that is what tells you "best time to call Rogers: Tue 9 am · avg hold 5 min". It switches to "call now" when live calls show short holds. A retention policy keeps raw events lean while the aggregate keeps the history.

**Snowflake.** Snowflake holds public plan prices and every negotiation outcome Holdless has seen. One `MEDIAN` query over both answers "people in Surrey pay $55 for this plan; you pay $96". Another ranks which arguments and vibes actually win at each company. That ranking becomes the voice agent's playbook for the next call, so every call makes the next one sharper.

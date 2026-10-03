# Holdless

AI that calls customer service for you. 24h hackathon, mobile-first web app.

## Repo layout

- `/web`: Next.js App Router + TypeScript + Tailwind. This is the app; work here.
- `/data`: Arteen's Python data service (FastAPI). **Do not edit anything under `/data`.** Call it over HTTP.

## Data service API (`/data`)

Run: `cd data && uvicorn holdless_data.api:app --reload --port 8100` (docs at `http://localhost:8100/docs`).
It needs no config. Every piece falls back to local stand-ins (sample bills, regex promise parser, in-memory/SQLite intel). All endpoints take and return JSON, and CORS is open.

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{ok, intel, events, llm}`: which backends are live or using fallbacks |
| `GET /bills/samples` | The 3 demo bills (`rogers_internet`, `bell_mobile`, `telus_mobile`) |
| `GET /samples/<id>.png` | Static sample bill images |
| `POST /bills/scan` | multipart `file` (JPEG/PNG/WebP/PDF) **or** form field `sample=<id>`. Returns the bill plus overpay: `headline`, `detail`, `overpay_mo`, `overpay_yr`, `worth_calling`, `best_time.label`, `scanned_by` (`claude`/`sample`) |
| `POST /overpay` | body: a `BillScan`. Returns the overpay result without scanning |
| `GET /best-time?company=Rogers` | Best time to call + avg hold |
| `POST /events` | One `CallEvent` or a list: `{call_id, company, event, hold_seconds?, vibe?, meta?}`; `event` ∈ `dialed, hold_started, hold_ended, rep_joined, transferred, takeover, promise, completed, failed` |
| `GET /playbook?company=&service=internet&province=&start_price=&tier=&download_mbps=&data_gb=` | Agent playbook: `playbook_text`, `best_vibe`, `target_price`, `accept_at_or_below`, `competitor_offer` |
| `POST /promises/extract?company=` | body: transcript `[{speaker, text}]`. Extracts promises only (no recording); for the live "promise detected" chip |
| `POST /calls/{call_id}/completed` | body: `{company, service, vibe, transcript, started_at, hold_seconds, start_price, province, city, tier}`. Returns `call.completed`: `outcome`, `promises[]`, `saved_mo/yr/total`, `rep_id`, `confirmation_number`, `transcript_sha256`, `promises_sha256`, `promises_canonical`. Also records the call to Tiger + Snowflake |

Use `/bills/scan` with `sample=rogers_internet` as the demo fallback. It should give "$41/mo · People in Surrey pay $55…".

## Design

- Background `#0D0D0C`, text `#F3EFE6`, accent lime `#D7FF3D`
- Fonts: Bricolage Grotesque (display) + DM Mono
- Big type, rounded cards, touch targets 44px or larger. Mobile-first.

## Golden path

1. Upload a bill
2. Parse it with Arteen's API (`POST /bills/scan`)
3. Show the overpay (Arteen's API / Snowflake)
4. Pick a vibe: Polite / Relentless / Lawyer / Grandma
5. `POST /api/calls` starts an ElevenLabs Twilio outbound call with `dynamic_variables` (include the playbook from `GET /playbook`)
6. `/call/[id]` polls `GET /api/calls/[id]`
7. When the call is done: read `data_collection_results`, sha256 the transcript + promises, and stamp a Solana devnet Memo tx
8. `/win/[id]` shows the Explorer link and a share button

## Rules

- Never block the golden path on extras.
- Every external call needs a timeout and a demo fallback: pre-loaded sample bills from `data/seed`, cached overpay, animated transcript.
- Keys go only in `.env.local`. Never commit them.
- Keep the code simple and readable.

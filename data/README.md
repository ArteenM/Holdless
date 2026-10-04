# Holdless data (Arteen): Snowflake + Tiger Data

Three queries, SQL only. Mehdi wires them into the backend.

| File | Run in | What it does |
|---|---|---|
| `handoff/snowflake_worksheet.sql` | Snowsight worksheet | Warehouse, tables, load steps, checks, Query 1 + Query 3 |
| `handoff/tiger_setup.sql` | Tiger Data SQL editor | `call_events` hypertable, 30 days of demo history, `hold_by_hour` continuous aggregate |
| `handoff/holdless_queries.sql` | (hand-off to Mehdi) | All 3 queries, INPUT lines marked |
| `handoff/clean/*.csv` | Snowsight → Load data | Tony's data, cleaned to load into the tables |

- **Query 1, "You're overpaying $X"** (Snowflake): median price of similar plans (half to double the speed or data) from other providers.
- **Query 2, "Best time to call"** (Tiger Data): the 3 hours with the shortest average hold, in Vancouver time.
- **Query 3, "Arguments that work"** (Snowflake): the arguments that won most often at a company.

Changes to Tony's CSVs in `clean/`:
- `DATA_GB = unlimited` became `999`.
- Freedom 5G Home Internet (3 rows) was left out: it's invite-only, so its prices can't be checked.

The call history in Tiger is demo data. Say so in the pitch.
Connection details go to Mehdi by private DM, never in this repo.

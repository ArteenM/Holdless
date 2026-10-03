-- Holdless call events on Tiger Data (TimescaleDB).
-- Run once:  psql "$TIGER_DATABASE_URL" -f data/sql/tiger/001_call_events.sql
-- Then seed: python -m holdless_data.seed tiger

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- One row per thing that happens on a call. The voice agent posts live events
-- (dialed, hold_started, hold_ended, rep_joined, ...); the data service writes
-- one `completed` row per call, timestamped at the moment the call was placed,
-- so hold time is attributed to when you dial, not when you hang up.
CREATE TABLE IF NOT EXISTS call_events (
    time          TIMESTAMPTZ NOT NULL,
    call_id       TEXT        NOT NULL,
    company       TEXT        NOT NULL,   -- normalized slug: rogers, telus, bc hydro ...
    event         TEXT        NOT NULL,
    hold_seconds  INTEGER,
    outcome       TEXT,
    saved_mo      NUMERIC(10,2),
    vibe          TEXT,
    meta          JSONB       NOT NULL DEFAULT '{}'::jsonb
);

SELECT create_hypertable('call_events', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS call_events_company_time ON call_events (company, time DESC);
CREATE INDEX IF NOT EXISTS call_events_call_id ON call_events (call_id, time);

-- Hourly hold time + win rate per company. Real-time (materialized_only = false)
-- so a call that just finished shows up in "best time to call" immediately.
CREATE MATERIALIZED VIEW IF NOT EXISTS hold_by_hour
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 hour', time) AS bucket,
       company,
       avg(hold_seconds)::double precision            AS avg_hold_s,
       count(hold_seconds)                             AS hold_samples,
       sum(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
       count(*)                                        AS completed,
       sum(coalesce(saved_mo, 0))                      AS saved_mo
FROM call_events
WHERE event = 'completed'
GROUP BY bucket, company
WITH NO DATA;

SELECT add_continuous_aggregate_policy('hold_by_hour',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => TRUE);

-- Raw events are only needed for a few months; the aggregate keeps the history.
SELECT add_retention_policy('call_events', INTERVAL '180 days', if_not_exists => TRUE);
